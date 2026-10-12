# wallet-mcp

An [MCP](https://modelcontextprotocol.io) server for the [BudgetBakers Wallet](https://budgetbakers.com/) REST API. Runs as a persistent HTTP service using MCP's [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http) transport — meant to be run as a long-lived background process (e.g. via systemd) that MCP clients connect to over the network, rather than a stdio subprocess a client spawns itself.

Covers the full Wallet API: Records (transactions), Accounts, Categories, Budgets, Labels, Standing Orders (recurring payments, read + delete only — creating/editing one requires the Wallet app), Goals (read-only), Record Rules (auto-categorization, read + delete only), and API usage stats.

## Security model

This server fronts a financial account and is reachable by every process on the
machine — a loopback HTTP endpoint with no auth is a write-capable proxy for
anything that can open a socket. So:

| Control | Behaviour |
|---|---|
| **Access token required** | Every request must carry `Authorization: Bearer <WALLET_MCP_AUTH_TOKEN>`. The server **refuses to start** if `WALLET_MCP_AUTH_TOKEN` is unset. Missing/wrong token → `401`. |
| **Access token is not forwarded** | `Authorization` is consumed locally for the access check. Per-caller Wallet API tokens travel in `X-Wallet-Token` and are the only value ever sent to BudgetBakers. |
| **No implicit Wallet token** | `WALLET_API_TOKEN` is used **only** for requests that already passed the access check. There is no unauthenticated fallback path. |
| **DNS-rebinding protection** | Transport-level `Host` validation plus a middleware that rejects any request carrying an unrecognised `Origin`. Non-browser MCP clients send no `Origin`; a present one means a web page is driving the request → `403`. |
| **Read-only mode** | `WALLET_MCP_READONLY=1` hides every `wallet_create*`/`wallet_update*`/`wallet_delete*` tool **and** refuses all non-GET calls at the client layer, so a tool added later can't bypass it. |
| **Bounded requests** | Outbound Wallet calls carry a timeout (default 30 s, `WALLET_MCP_TIMEOUT_MS`); request bodies are capped (default 256 KB). |
| **Fail-closed start** | Refuses to start unauthenticated; warns loudly when bound to a non-loopback address. |

### Two secrets, two headers

```
Authorization: Bearer <WALLET_MCP_AUTH_TOKEN>   # required — the endpoint's own access secret
X-Wallet-Token:  <Wallet REST API token>        # optional — this caller's BudgetBakers token
```

Two supported modes:

- **Single caller (typical)**: set both `WALLET_MCP_AUTH_TOKEN` and `WALLET_API_TOKEN` on the
  server, and give clients only the access secret. The server holds the Wallet token.
- **Shared instance, per-caller accounts**: set only `WALLET_MCP_AUTH_TOKEN`; each caller sends
  its own `X-Wallet-Token` per request. The server then holds no Wallet token at all.

Precedence for the Wallet token: `X-Wallet-Token` → `WALLET_API_TOKEN` → explicit error (the
request is never attempted).

## Prerequisites

- Node.js 20 or newer (`node --version`)
- A [BudgetBakers Wallet](https://budgetbakers.com/) account on the **Premium** plan — the REST API isn't available on the free plan
- An MCP client that supports Streamable HTTP transport (Claude Code, Hermes, or any custom MCP client)

## Setup

```bash
git clone https://github.com/vdimko/wallet-mcp.git
cd wallet-mcp
npm install
npm run build
```

Generate two secrets — an access secret for this endpoint and (optionally) a Wallet
API token from https://web.budgetbakers.com/settings/rest-api:

```bash
openssl rand -hex 32                 # → WALLET_MCP_AUTH_TOKEN
```

Keep both secret, don't commit them anywhere. The access secret is what clients present;
the Wallet token, if the server holds it, never leaves the machine except on calls to
`rest.budgetbakers.com`.

## Running it

```bash
export WALLET_MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export WALLET_API_TOKEN="<token from budgetbakers settings>"   # optional
export WALLET_MCP_READONLY=1                                   # optional: read-only
npm start
```

By default it listens on `http://127.0.0.1:7691/mcp` — loopback only, not reachable from
the network. Override with the `WALLET_MCP_HOST` / `WALLET_MCP_PORT` env vars if needed.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WALLET_MCP_AUTH_TOKEN` | — | **Required.** Access secret clients present as `Authorization: Bearer …`. |
| `WALLET_API_TOKEN` | unset | Optional Wallet API token the server uses for authenticated callers. |
| `WALLET_MCP_READONLY` | off | `1`/`true` → hide and refuse every mutating call. |
| `WALLET_MCP_HOST` | `127.0.0.1` | Bind address. Anything else is network-reachable — warns at startup. |
| `WALLET_MCP_PORT` | `7691` | Bind port. |
| `WALLET_MCP_ALLOWED_HOSTS` | loopback forms of host:port | `Host` header values accepted by the DNS-rebinding guard. |
| `WALLET_MCP_ALLOWED_ORIGINS` | empty (deny all) | `Origin` values allowed. Empty means any request carrying an `Origin` is rejected. |
| `WALLET_MCP_TIMEOUT_MS` | `30000` | Timeout for outbound Wallet API calls. |
| `WALLET_MCP_MAX_BODY` | `256kb` | Maximum accepted request body. |

### As a background service (systemd)

A ready-to-adapt unit is in [`systemd/wallet-mcp.service.example`](systemd/wallet-mcp.service.example).
It reads secrets from a `0600` environment file (never from the unit itself, whose
`Environment=` lines are world-readable) and applies a hardened sandbox
(`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges`, `PrivateTmp`,
`SystemCallFilter`, …). To install as a per-user service (no root required):

```bash
install -m 600 /dev/null ~/.config/wallet-mcp.env
printf 'WALLET_MCP_AUTH_TOKEN=%s\n' "$(openssl rand -hex 32)" >> ~/.config/wallet-mcp.env

cp systemd/wallet-mcp.service.example ~/.config/systemd/user/wallet-mcp.service
# edit the paths inside to match where you cloned the repo
systemctl --user daemon-reload
systemctl --user enable --now wallet-mcp.service
loginctl enable-linger "$USER"   # keeps it running after you log out
```

Check it's up — an unauthenticated request must now fail:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:7691/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'      # → 401

curl -s -X POST http://127.0.0.1:7691/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $WALLET_MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'      # → tool list
```

⚠️ If you change the bind host to something other than `127.0.0.1`, the endpoint becomes
network-reachable and the access token is the only gate. Put it behind a firewall/VPN, or
don't do it.

## Register with an MCP client

Every client must send `Authorization: Bearer <WALLET_MCP_AUTH_TOKEN>` on each request, and
`X-Wallet-Token` only if the server doesn't hold a Wallet token of its own.

### Hermes

```bash
hermes mcp add --url http://127.0.0.1:7691/mcp --auth header wallet
# paste the WALLET_MCP_AUTH_TOKEN value when prompted
```

Hermes stores the template `Authorization: Bearer ${MCP_WALLET_API_KEY}` in `config.yaml` and
the secret in the profile's `.env`. Add `X-Wallet-Token: ${WALLET_TOKEN}` to that server's
`headers:` map if callers use their own Wallet tokens.

### Claude Code

```bash
claude mcp add --transport http wallet http://127.0.0.1:7691/mcp \
  --header "Authorization: Bearer $WALLET_MCP_AUTH_TOKEN"
```

Verify it's connected with `claude mcp list`, then ask Claude something like *"list my
Wallet accounts"* to confirm it can reach the API.

### Other MCP clients

Point the client at `http://127.0.0.1:7691/mcp` using Streamable HTTP transport with the
`Authorization` header above.

### Client-side hardening

In read-only mode the mutating tools aren't advertised at all. To restrict an agent further
(e.g. hide delete tools while keeping create), disable individual tools in the client:
`hermes mcp configure` for Hermes, `claude mcp` settings for Claude Code.

## Tools

39 tools when writes are enabled; 22 in read-only mode
(every `wallet_create*`, `wallet_update*` and `wallet_delete*` is filtered out).

| Tool | Description |
|---|---|
| `wallet_list_records` | List transactions — pagination + filters on account/date/category/label/note/payee/amount/type/state/source |
| `wallet_get_record` | Get one record by ID |
| `wallet_create_records` | Create up to 50 transactions |
| `wallet_update_records` | Patch up to 10 transactions ($clear, place, labelIds add/remove, transfer edits) |
| `wallet_delete_records` | Delete up to 10 transactions |
| `wallet_record_references` | Check what references given records |
| `wallet_list_accounts` | List accounts |
| `wallet_get_account` | Get one account by ID |
| `wallet_create_account` | Create an account |
| `wallet_update_accounts` | Patch up to 10 accounts |
| `wallet_delete_accounts` | Delete up to 10 accounts |
| `wallet_account_references` | Check what references given accounts |
| `wallet_list_categories` | List categories (system + custom) |
| `wallet_get_category` | Get one category by ID |
| `wallet_create_category` | Create a custom category |
| `wallet_update_categories` | Patch up to 10 categories |
| `wallet_delete_categories` | Delete up to 10 custom categories |
| `wallet_category_references` | Check what references given categories |
| `wallet_list_budgets` | List budgets |
| `wallet_get_budget` | Get one budget by ID |
| `wallet_create_budget` | Create a budget |
| `wallet_update_budgets` | Patch up to 10 budgets (limits, overrides, tracked accounts/categories/labels) |
| `wallet_delete_budgets` | Delete up to 10 budgets |
| `wallet_list_labels` | List labels/hashtags |
| `wallet_get_label` | Get one label by ID |
| `wallet_create_label` | Create a label |
| `wallet_update_labels` | Patch up to 10 labels |
| `wallet_delete_labels` | Delete up to 10 labels |
| `wallet_label_references` | Check what references given labels |
| `wallet_list_standing_orders` | List recurring payments (read-only — create/edit needs the Wallet app) |
| `wallet_get_standing_order` | Get one standing order by ID |
| `wallet_list_standing_order_items` | List standing-order occurrences (due/paid/dismissed history) |
| `wallet_delete_standing_orders` | Delete up to 10 standing orders |
| `wallet_list_goals` | List savings goals (fully read-only) |
| `wallet_get_goal` | Get one goal by ID |
| `wallet_list_record_rules` | List auto-categorization rules (read + delete only) |
| `wallet_get_record_rule` | Get one record rule by ID |
| `wallet_delete_record_rules` | Delete up to 10 record rules |
| `wallet_api_usage_stats` | Get REST API usage stats for the calling token |

## Notes

- Batch write endpoints (`POST`/`PATCH`/`DELETE` with multiple items) can return HTTP 207
  with a mix of per-item successes and failures; that's returned as normal tool output,
  not an error.
- Wallet rate-limits at 300 requests/hour **per token**. Tool responses append a warning
  once the `X-RateLimit-Remaining` header drops to 5 or below. The server does not
  rate-limit inbound requests, so a runaway client can burn that quota.
- Filter parameters on `wallet_list_records` accept the API's `gte.`/`lte.`/`contains.`/
  `contains-i.` prefix syntax (e.g. `"gte.100"`), or a plain value for exact match.
- Each MCP request is stateless: the server doesn't persist sessions between calls, so
  there's nothing to clean up if a client disconnects mid-conversation.
- Tool output (your transactions) is returned to the MCP client verbatim, which means it
  lands in whatever LLM context is driving that client. Read-only mode plus a scoped token
  is the lever if that matters to you.

## Troubleshooting

- **Server exits immediately** — `WALLET_MCP_AUTH_TOKEN` isn't set. It refuses to start
  unauthenticated; generate one with `openssl rand -hex 32`.
- **401 from the server (not from Wallet)** — the `Authorization` header is missing, or the
  access secret doesn't match. The message says which: `Unauthorized: missing or invalid
  access token.`
- **403 with "origin not allowed"** — the request carried an `Origin` header. A browser (or
  a page exploiting DNS rebinding) is driving it. CLI/agent clients shouldn't send one; add
  the value to `WALLET_MCP_ALLOWED_ORIGINS` only if a browser client genuinely needs access.
- **403 with "Invalid Host header"** — the `Host` didn't match the bind address. Add it to
  `WALLET_MCP_ALLOWED_HOSTS` if you're reaching the server through a proxy.
- **"No Wallet API token available"** — the request passed auth, but neither an
  `X-Wallet-Token` header nor a server-side `WALLET_API_TOKEN` was present.
- **"Read-only mode: refusing …"** — `WALLET_MCP_READONLY` is on. Unset it to allow writes.
- **HTTP 401/404 from the API with a token set** — the *Wallet* token is invalid, expired, or
  was revoked; generate a new one at https://web.budgetbakers.com/settings/rest-api.
- **HTTP 403 / a "Premium required" style message** — the REST API needs an active
  Wallet Premium subscription.
- **HTTP 429** — you've hit the 300 requests/hour limit; wait for it to reset or reduce
  call frequency.
- **Client can't connect** — confirm the service is actually running (`systemctl --user
  status wallet-mcp.service` or `curl` the `/mcp` endpoint) and that the client is
  configured for Streamable HTTP, not stdio.

## Development

```bash
npm run dev    # tsc --watch
npm start      # run the built server
```

### Security regression probes

`scripts/security-probe.py` asserts the controls above against a live build — fail-closed
startup, 401 without/with a wrong access token, foreign `Origin`/`Host` rejection, that the
access token is never reused as the Wallet token, read-only tool filtering, the client-layer
write refusal, and the upstream timeout. It uses a deliberately invalid Wallet token, so it
cannot touch real data.

```bash
npm run build
python3 scripts/security-probe.py     # exits non-zero on any regression
```

## License

[MIT](LICENSE)
