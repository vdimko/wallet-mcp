#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerRecordTools } from "./tools/records.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerBudgetTools } from "./tools/budgets.js";

const HOST = process.env.WALLET_MCP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WALLET_MCP_PORT ?? 7691);

function buildServer(): McpServer {
  const server = new McpServer({ name: "wallet-mcp", version: "0.1.0", title: "BudgetBakers Wallet" });
  registerRecordTools(server);
  registerAccountTools(server);
  registerCategoryTools(server);
  registerBudgetTools(server);
  return server;
}

const app = express();
app.use(express.json());

// Stateless: each request gets its own server+transport, and carries its own Wallet API
// token via the Authorization header (falling back to WALLET_API_TOKEN if a caller omits it).
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
  if (!process.env.WALLET_API_TOKEN) {
    console.error(
      "[wallet-mcp] No WALLET_API_TOKEN set on the server; callers must send their own " +
        "Authorization: Bearer <token> header with each request.",
    );
  }
});
