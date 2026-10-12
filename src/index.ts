#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerRecordTools } from "./tools/records.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerBudgetTools } from "./tools/budgets.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerStandingOrderTools } from "./tools/standing-orders.js";
import { registerGoalTools } from "./tools/goals.js";
import { registerRecordRuleTools } from "./tools/record-rules.js";
import { registerApiUsageTools } from "./tools/api-usage.js";
import { rejectForeignOrigins, requireAccessToken } from "./auth.js";
import { applyReadOnlyPolicy } from "./readonly.js";
import {
  allowedHosts,
  allowedOrigins,
  authToken,
  bodyLimit,
  isNetworkExposed,
  readonlyMode,
  serverWalletToken,
} from "./config.js";

const HOST = process.env.WALLET_MCP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WALLET_MCP_PORT ?? 7691);

// Fail closed. This endpoint fronts a financial account, and it is reachable by
// every process on the machine — an unauthenticated bind is a write-capable
// proxy for anything that can open a loopback socket.
if (!authToken()) {
  console.error(
    "[wallet-mcp] FATAL: WALLET_MCP_AUTH_TOKEN is not set — refusing to start unauthenticated.\n" +
      "[wallet-mcp] Generate one with:  openssl rand -hex 32\n" +
      "[wallet-mcp] Then give the same value to every MCP client as an Authorization header\n" +
      "[wallet-mcp] (see README → Security model).",
  );
  process.exit(1);
}

function buildServer(): McpServer {
  const server = applyReadOnlyPolicy(
    new McpServer({ name: "wallet-mcp", version: "0.3.0", title: "BudgetBakers Wallet" }),
  );
  registerRecordTools(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerBudgetTools(server);
  registerLabelTools(server);
  registerStandingOrderTools(server);
  registerGoalTools(server);
  registerRecordRuleTools(server);
  registerApiUsageTools(server);
  return server;
}

const app = express();
app.disable("x-powered-by");
// An MCP JSON-RPC frame is a few KB; the default 100kb was already generous.
app.use(express.json({ limit: bodyLimit() }));

// Stateless: each request gets its own server+transport, and carries its own
// Wallet API token in X-Wallet-Token (falling back to the server's WALLET_API_TOKEN
// if the operator configured one). The Authorization header carries the access
// token and is never forwarded upstream.
app.post("/mcp", rejectForeignOrigins, requireAccessToken, async (req, res) => {
  const server = buildServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // A page that DNS-rebinds its own domain onto 127.0.0.1 still sends its
      // own Host header — that mismatch is the whole tell.
      enableDnsRebindingProtection: true,
      allowedHosts: allowedHosts(HOST, PORT),
      ...(allowedOrigins().length > 0 ? { allowedOrigins: allowedOrigins() } : {}),
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[wallet-mcp] Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

for (const method of ["get", "delete"] as const) {
  app[method]("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });
}

app.listen(PORT, HOST, () => {
  console.error(`[wallet-mcp] Listening on http://${HOST}:${PORT}/mcp`);
  console.error("[wallet-mcp] Access token required on every request (Authorization header).");
  console.error(
    serverWalletToken()
      ? "[wallet-mcp] Wallet token: server-side WALLET_API_TOKEN; callers may override it with X-Wallet-Token."
      : "[wallet-mcp] Wallet token: none on the server; every caller must send X-Wallet-Token.",
  );
  if (readonlyMode()) {
    console.error("[wallet-mcp] READ-ONLY mode: every non-GET Wallet API call is refused.");
  }
  if (isNetworkExposed(HOST)) {
    console.error(
      `[wallet-mcp] WARNING: bound to ${HOST} — reachable from the network, not just this host. ` +
        "The access token is the only gate; prefer 127.0.0.1 or put it behind a firewall.",
    );
  }
});
