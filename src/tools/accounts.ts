import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool } from "../format.js";
import { pagination, colorHint, uuid } from "../schemas.js";

const ACCOUNT_TYPES = ["General", "Cash", "CurrentAccount", "SavingAccount", "Insurance"] as const;

const updateAccountItem = z.object({
  id: uuid.describe("ID of the account to update."),
  name: z.string().max(80).optional(),
  archived: z.boolean().optional().describe("Archive or unarchive the account."),
  color: z.string().optional().describe(colorHint),
  initialBalance: z.number().optional(),
  excludeFromStats: z.boolean().optional().describe("Exclude this account's records from budgets/statistics."),
  bankAccountNumber: z.string().max(80).optional(),
});

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_accounts",
    {
      title: "List accounts",
      description: "List financial accounts (cash, bank, savings, etc). Supports pagination.",
      inputSchema: { ...pagination },
    },
    async ({ limit, offset }) => runTool(() => walletRequest("GET", "/accounts", { query: { limit, offset } })),
  );

  server.registerTool(
    "wallet_get_account",
    {
      title: "Get account",
      description: "Fetch a single account by ID.",
      inputSchema: { id: uuid.describe("Account ID.") },
    },
    async ({ id }) => runTool(() => walletRequest("GET", `/accounts/${id}`)),
  );

  server.registerTool(
    "wallet_create_account",
    {
      title: "Create account",
      description: "Create a new financial account.",
      inputSchema: {
        name: z.string().max(80).describe("Account display name, max 80 characters."),
        accountType: z.enum(ACCOUNT_TYPES).describe("Kind of account."),
        currencyCode: z.string().length(3).describe("ISO 4217 currency code, e.g. USD, EUR."),
        initialBalance: z.number().describe("Starting balance in the account's currency."),
        color: z.string().optional().describe(colorHint),
      },
    },
    async (input) => runTool(() => walletRequest("POST", "/accounts", { body: input })),
  );

  server.registerTool(
    "wallet_update_accounts",
    {
      title: "Update accounts",
      description:
        "Patch up to 10 accounts in one call, e.g. to rename, archive, recolor, or adjust initial balance. " +
        "Returns HTTP 200 on full success or 207 with per-item success/error details on partial failure.",
      inputSchema: {
        accounts: z.array(updateAccountItem).min(1).max(10).describe("Up to 10 partial account updates, each with an id."),
      },
    },
    async ({ accounts }) => runTool(() => walletRequest("PATCH", "/accounts", { body: accounts })),
  );

  server.registerTool(
    "wallet_account_references",
    {
      title: "Check account references",
      description:
        "List entities (records, budgets, standing orders, etc.) that reference an account — useful to check " +
        "before attempting operations that require the account to be unreferenced.",
      inputSchema: { id: uuid.describe("Account ID to check.") },
    },
    async ({ id }) => runTool(() => walletRequest("GET", "/accounts/references", { query: { id } })),
  );
}
