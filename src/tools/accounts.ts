import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool, registerReferencesTool } from "./shared.js";
import { commonListParams, timestampFilters, textFilter, toFilterArray, colorSchema, entityId } from "../schemas.js";

/** Creatable via API. Wallet also has read-only types (CreditCard, Investment, Loan, Mortgage, Overdraft, Bonus) — bank-sync/mobile only. */
const CREATABLE_ACCOUNT_TYPES = ["General", "Cash", "CurrentAccount", "SavingAccount", "Insurance"] as const;

const ALL_ACCOUNT_TYPES = [
  ...CREATABLE_ACCOUNT_TYPES,
  "CreditCard",
  "Investment",
  "Loan",
  "Mortgage",
  "Overdraft",
  "Bonus",
] as const;

const updateAccountItem = z.object({
  id: entityId.describe("ID of the account to update."),
  name: z.string().max(80).optional(),
  archived: z.boolean().optional().describe("Archive or unarchive the account (Wallet has no hard-delete-then-forget; archive is the usual retirement path)."),
  color: colorSchema.optional(),
  initialBalance: z.number().optional().describe("Initial balance amount. Omit = no change."),
  excludeFromStats: z.boolean().optional(),
  bankAccountNumber: z.string().max(80).optional().describe("Bank account number or IBAN, max 80 chars. Empty string clears it."),
});

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_accounts",
    {
      title: "List accounts",
      description: "List financial accounts (cash, bank, savings, credit cards, etc).",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        accountType: z.enum(ALL_ACCOUNT_TYPES).optional().describe("Case-insensitive exact match."),
        currencyCode: z.string().optional().describe("ISO 4217 code, exact match, case-insensitive."),
        archived: z.boolean().optional().describe("true = archived only, false = active only, omit = both."),
        budgetId: entityId.optional().describe("Only accounts tracked by this budget."),
        sortBy: z.string().optional().describe('+/- prefixed field: createdAt or updatedAt. Example: "-createdAt".'),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/accounts", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            accountType: params.accountType,
            currencyCode: params.currencyCode,
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
            archived: params.archived,
            budgetId: params.budgetId,
            sortBy: params.sortBy,
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_account",
    {
      title: "Get account",
      description: "Fetch a single account by ID (filters the list endpoint by id — there's no dedicated single-account path).",
      inputSchema: { id: entityId.describe("Account ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/accounts", { token: requestToken(extra), query: { id } })),
  );

  server.registerTool(
    "wallet_create_account",
    {
      title: "Create account",
      description: "Create a new financial account. Only General/Cash/CurrentAccount/SavingAccount/Insurance are creatable via API — the bank-sync/mobile-only types (CreditCard, Investment, Loan, Mortgage, Overdraft, Bonus) can't be created this way.",
      inputSchema: {
        name: z.string().max(80).describe("Account display name, max 80 characters."),
        accountType: z.enum(CREATABLE_ACCOUNT_TYPES),
        currencyCode: z.string().describe("3-letter ISO 4217 currency code."),
        initialBalance: z.number().describe("Starting balance, e.g. 1500.50."),
        color: colorSchema.optional().describe("Randomly assigned if omitted."),
        bankAccountNumber: z.string().max(80).optional(),
        excludeFromStats: z.boolean().optional().describe("Default false."),
      },
    },
    async (input, extra) => runTool(() => walletRequest("POST", "/v1/api/accounts", { token: requestToken(extra), body: input })),
  );

  server.registerTool(
    "wallet_update_accounts",
    {
      title: "Update accounts",
      description:
        "Patch up to 10 accounts in one call — rename, archive, recolor, adjust initial balance, etc. accountType " +
        "isn't patchable. Returns HTTP 200 on full success or 207 with per-item success/error details otherwise.",
      inputSchema: {
        accounts: z.array(updateAccountItem).min(1).max(10).describe("Up to 10 partial account updates, each with an id."),
        returnData: z.boolean().optional().describe("Set false to omit each updated account's full body. Default true."),
      },
    },
    async ({ accounts, returnData }, extra) =>
      runTool(() =>
        walletRequest("PATCH", "/v1/api/accounts", { token: requestToken(extra), query: { returnData }, body: accounts }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_accounts",
    type: "accounts",
    title: "Delete accounts",
    description:
      "Delete up to 10 accounts by ID. Check wallet_account_references first — an account referenced by " +
      "records/standing-orders/budgets/record-rules can't be deleted until those references are cleared.",
  });

  registerReferencesTool(server, {
    name: "wallet_account_references",
    type: "accounts",
    title: "Check account references",
    description: "List records, standing orders, budgets, record rules, and other entities that reference given accounts.",
  });
}
