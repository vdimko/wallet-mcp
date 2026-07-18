#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRecordTools } from "./tools/records.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerBudgetTools } from "./tools/budgets.js";

const server = new McpServer({
  name: "wallet-mcp",
  version: "0.1.0",
  title: "BudgetBakers Wallet",
});

registerRecordTools(server);
registerAccountTools(server);
registerCategoryTools(server);
registerBudgetTools(server);

async function main() {
  if (!process.env.WALLET_API_TOKEN) {
    console.error(
      "[wallet-mcp] Warning: WALLET_API_TOKEN is not set. Tool calls will fail until it's configured " +
        "(generate one at https://web.budgetbakers.com/settings/rest-api).",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[wallet-mcp] Fatal error:", err);
  process.exit(1);
});
