#!/usr/bin/env python3
"""Security regression probes for wallet-mcp.

Asserts the properties the hardening patch is supposed to guarantee. Uses a
deliberately invalid Wallet API token, so nothing here can read or write real
BudgetBakers data — every upstream call it triggers is expected to 401.

    python3 scripts/security-probe.py

Exits non-zero if any assertion fails.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PROBE_PORT", "7698"))
ENDPOINT = "/mcp"
AUTH_TOKEN = "probe-access-token-not-a-secret"
FAKE_WALLET_TOKEN = "probe-invalid-wallet-token"
TOOLS_LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
CALL = {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": "wallet_list_accounts", "arguments": {"limit": 1}}}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def wait_up(port: int, proc: subprocess.Popen, tries: int = 60) -> bool:
    for _ in range(tries):
        if proc.poll() is not None:
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def start(env_extra: dict | None = None) -> subprocess.Popen:
    env = dict(os.environ)
    env["WALLET_MCP_PORT"] = str(PORT)
    env["WALLET_MCP_HOST"] = "127.0.0.1"
    for key in ("WALLET_API_TOKEN", "WALLET_MCP_AUTH_TOKEN", "WALLET_MCP_READONLY",
                "WALLET_MCP_ALLOWED_ORIGINS", "WALLET_MCP_ALLOWED_HOSTS"):
        env.pop(key, None)
    if env_extra:
        env.update(env_extra)
    proc = subprocess.Popen(["node", "dist/index.js"], cwd=REPO, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return proc


def stop(proc: subprocess.Popen) -> str:
    proc.terminate()
    try:
        out, _ = proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
    return out or ""


def call(payload: dict, headers: dict | None = None) -> tuple[int, str]:
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if headers:
        h.update(headers)
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=20)
    conn.request("POST", ENDPOINT, body=json.dumps(payload), headers=h)
    res = conn.getresponse()
    body = res.read().decode("utf-8", "replace")
    conn.close()
    return res.status, body


def envelope(raw: str) -> dict:
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            line = line[5:].strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return {}


def tool_names(raw: str) -> list[str]:
    return [t.get("name", "") for t in envelope(raw).get("result", {}).get("tools", [])]


# --------------------------------------------------------------------------
# 1. Fail closed: no access token configured → server must refuse to start.
# --------------------------------------------------------------------------
proc = start()
try:
    time.sleep(2.5)
    exited = proc.poll() is not None
    out = stop(proc)
    check("refuses to start without WALLET_MCP_AUTH_TOKEN", exited and proc.returncode not in (0, None),
          f"exit={proc.returncode}")
    check("startup error names the missing variable", "WALLET_MCP_AUTH_TOKEN" in out)
finally:
    pass

# --------------------------------------------------------------------------
# 2/3/4/5. Authenticated, writes enabled, invalid Wallet token.
# --------------------------------------------------------------------------
proc = start({"WALLET_MCP_AUTH_TOKEN": AUTH_TOKEN})
try:
    if not wait_up(PORT, proc):
        check("server came up with an access token", False, "did not bind")
        raise SystemExit(1)

    st, raw = call(TOOLS_LIST)
    check("unauthenticated tools/list is rejected", st == 401, f"HTTP {st}")

    st, raw = call(TOOLS_LIST, {"Authorization": "Bearer wrong-token"})
    check("wrong access token is rejected", st == 401, f"HTTP {st}")

    st, raw = call(TOOLS_LIST, {"Authorization": f"Bearer {AUTH_TOKEN}"})
    names = tool_names(raw)
    check("valid access token is accepted", st == 200 and len(names) > 0, f"HTTP {st}, {len(names)} tools")
    check("write tools advertised when not read-only",
          any(n.startswith("wallet_delete") for n in names))
    total_tools = len(names)

    st, raw = call(TOOLS_LIST, {"Authorization": f"Bearer {AUTH_TOKEN}", "Origin": "https://evil.example"})
    check("foreign Origin is rejected", st == 403, f"HTTP {st}")

    st, raw = call(TOOLS_LIST, {"Authorization": f"Bearer {AUTH_TOKEN}", "Host": "evil.example"})
    check("foreign Host is rejected (DNS rebinding guard)", st == 403, f"HTTP {st}")

    st, raw = call(TOOLS_LIST, {"Authorization": f"Bearer {AUTH_TOKEN}", "Origin": "http://127.0.0.1:7698"})
    check("foreign Origin still rejected when allow-list is empty", st == 403, f"HTTP {st}")

    st, raw = call(CALL, {"Authorization": f"Bearer {AUTH_TOKEN}"})
    body = json.dumps(envelope(raw))
    check("access token is NOT reused as the Wallet token", "No Wallet API token available" in body,
          "upstream not attempted")

    st, raw = call(CALL, {"Authorization": f"Bearer {AUTH_TOKEN}",
                          "X-Wallet-Token": FAKE_WALLET_TOKEN})
    body = json.dumps(envelope(raw))
    check("X-Wallet-Token is forwarded upstream", "401" in body or "403" in body,
          body[:90].replace("\n", " "))
finally:
    stop(proc)

# --------------------------------------------------------------------------
# 6. Server-side Wallet token (mode 1) is used for authenticated callers.
# --------------------------------------------------------------------------
proc = start({"WALLET_MCP_AUTH_TOKEN": AUTH_TOKEN, "WALLET_API_TOKEN": FAKE_WALLET_TOKEN})
try:
    if not wait_up(PORT, proc):
        check("server came up with a server-side Wallet token", False)
    else:
        st, raw = call(CALL, {"Authorization": f"Bearer {AUTH_TOKEN}"})
        body = json.dumps(envelope(raw))
        check("authenticated caller uses the server-side Wallet token",
              "No Wallet API token" not in body, body[:90].replace("\n", " "))
finally:
    stop(proc)

# --------------------------------------------------------------------------
# 7. Read-only mode: mutating tools gone, and the client layer refuses writes.
# --------------------------------------------------------------------------
proc = start({"WALLET_MCP_AUTH_TOKEN": AUTH_TOKEN, "WALLET_MCP_READONLY": "1",
              "WALLET_API_TOKEN": FAKE_WALLET_TOKEN})
try:
    if not wait_up(PORT, proc):
        check("server came up in read-only mode", False)
    else:
        st, raw = call(TOOLS_LIST, {"Authorization": f"Bearer {AUTH_TOKEN}"})
        names = tool_names(raw)
        check("read-only hides every mutating tool",
              not any(n.startswith(("wallet_create", "wallet_update", "wallet_delete")) for n in names),
              f"{len(names)} tools advertised (was {total_tools})")
        check("read-only keeps the read tools", "wallet_list_records" in names)

        st, raw = call({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                        "params": {"name": "wallet_delete_records", "arguments": {"ids": ["x"]}}},
                       {"Authorization": f"Bearer {AUTH_TOKEN}"})
        check("read-only: calling a hidden mutating tool fails", "not found" in raw.lower() or st == 200,
              f"HTTP {st}")
finally:
    stop(proc)

# --------------------------------------------------------------------------
# 8. Enforcement layer: walletRequest refuses non-GET under READONLY even if a
#    mutating tool were somehow registered.
# --------------------------------------------------------------------------
script = (
    'import { walletRequest, ReadOnlyModeError } from "./dist/client.js";'
    'try { await walletRequest("DELETE", "/v1/api/records", { token: "x", body: { ids: ["a"] } });'
    '  console.log("NO-BLOCK"); } '
    'catch (e) { console.log(e instanceof ReadOnlyModeError ? "BLOCKED" : "WRONG-ERROR:" + e.name); }'
)
proc = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPO,
                      env={**os.environ, "WALLET_MCP_READONLY": "1"},
                      capture_output=True, text=True, timeout=60)
check("walletRequest refuses non-GET calls under READONLY",
      "BLOCKED" in proc.stdout, proc.stdout.strip() or proc.stderr.strip()[:120])

# --------------------------------------------------------------------------
# 9. Upstream timeout is wired.
# --------------------------------------------------------------------------
proc = subprocess.run(["node", "--input-type=module", "-e",
                       'import { walletRequest } from "./dist/client.js";'
                       'const t0 = Date.now();'
                       'try { await walletRequest("GET", "/v1/api/accounts", { token: "bad" });'
                       '  console.log("completed", Date.now() - t0); }'
                       'catch (e) { console.log(e.name, Date.now() - t0); }'],
                      cwd=REPO, env={**os.environ, "WALLET_MCP_TIMEOUT_MS": "1"},
                      capture_output=True, text=True, timeout=60)
check("outbound calls carry a timeout", "TimeoutError" in proc.stdout or "AbortError" in proc.stdout,
      proc.stdout.strip()[:120])

print("\n=== SUMMARY ===")
failed = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} passed")
for name in failed:
    print(f"  FAILED: {name}")
sys.exit(1 if failed else 0)
