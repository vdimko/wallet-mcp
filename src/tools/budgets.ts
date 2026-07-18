import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool } from "../format.js";
import { pagination, uuid } from "../schemas.js";

const BUDGET_TYPES = [
  "BUDGET_INTERVAL_WEEK",
  "BUDGET_INTERVAL_MONTH",
  "BUDGET_INTERVAL_YEAR",
  "BUDGET_CUSTOM",
] as const;

const idListOrDiff = z
  .union([
    z.array(uuid),
    z.object({
      add: z.array(uuid).optional(),
      remove: z.array(uuid).optional(),
    }),
  ])
  .describe("Either a full replacement array of IDs, or {add, remove} to adjust the existing set incrementally.");

const updateBudgetItem = z.object({
  id: uuid.describe("ID of the budget to update."),
  name: z.string().max(80).optional(),
  resetLimit: z.boolean().optional().describe("Reset the limit override for the current period."),
  limitOverrides: z
    .array(z.record(z.string(), z.unknown()))
    .max(50)
    .optional()
    .describe(
      "Up to 50 per-period limit overrides. Fetch the budget with wallet_get_budget first to see the exact " +
        "object shape Wallet expects for this budget's type before sending overrides.",
    ),
  accountIds: idListOrDiff.optional(),
  categoryIds: idListOrDiff.optional(),
  labelIds: idListOrDiff.optional(),
  closed: z.boolean().optional().describe("Mark the budget as closed/inactive."),
});

export function registerBudgetTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_budgets",
    {
      title: "List budgets",
      description: "List spending budgets and their tracked limits. Supports pagination.",
      inputSchema: { ...pagination },
    },
    async ({ limit, offset }) => runTool(() => walletRequest("GET", "/budgets", { query: { limit, offset } })),
  );

  server.registerTool(
    "wallet_get_budget",
    {
      title: "Get budget",
      description: "Fetch a single budget by ID, including its current tracked spend.",
      inputSchema: { id: uuid.describe("Budget ID.") },
    },
    async ({ id }) => runTool(() => walletRequest("GET", `/budgets/${id}`)),
  );

  server.registerTool(
    "wallet_create_budget",
    {
      title: "Create budget",
      description:
        "Create a new spending budget scoped to a recurring interval (week/month/year) or a custom date " +
        "range, optionally restricted to specific accounts, categories, and/or labels.",
      inputSchema: {
        name: z.string().max(80).describe("Budget display name, max 80 characters."),
        currencyCode: z.string().length(3).describe("ISO 4217 currency code, e.g. USD, EUR."),
        type: z.enum(BUDGET_TYPES).describe("Recurrence: weekly/monthly/yearly interval, or a custom date range."),
        limit: z.number().positive().describe("Spending limit for the period; must be greater than 0."),
        startDate: z.string().optional().describe("YYYY-MM-DD. Required (with endDate) when type is BUDGET_CUSTOM."),
        endDate: z.string().optional().describe("YYYY-MM-DD. Required (with startDate) when type is BUDGET_CUSTOM."),
        categoryIds: z.array(uuid).optional().describe("Restrict tracking to these categories; omit for all."),
        accountIds: z.array(uuid).optional().describe("Restrict tracking to these accounts; omit for all."),
        labelIds: z.array(uuid).optional().describe("Restrict tracking to records with these labels."),
      },
    },
    async (input) => runTool(() => walletRequest("POST", "/budgets", { body: input })),
  );

  server.registerTool(
    "wallet_update_budgets",
    {
      title: "Update budgets",
      description:
        "Patch up to 10 budgets in one call, e.g. to rename, close, or adjust their account/category/label " +
        "scope. Returns HTTP 200 on full success or 207 with per-item success/error details on partial failure.",
      inputSchema: {
        budgets: z.array(updateBudgetItem).min(1).max(10).describe("Up to 10 partial budget updates, each with an id."),
      },
    },
    async ({ budgets }) => runTool(() => walletRequest("PATCH", "/budgets", { body: budgets })),
  );

  server.registerTool(
    "wallet_delete_budgets",
    {
      title: "Delete budgets",
      description: "Delete up to 10 budgets by ID. Budgets have no reference restrictions and are always deletable.",
      inputSchema: {
        ids: z.array(uuid).min(1).max(10).describe("Up to 10 budget IDs to delete."),
      },
    },
    async ({ ids }) => runTool(() => walletRequest("DELETE", "/v1/api/budgets", { query: { id: ids.join(",") } })),
  );
}
