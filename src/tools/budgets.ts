import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool } from "./shared.js";
import {
  commonListParams,
  timestampFilters,
  textFilter,
  rangeFilter,
  commaListFilter,
  toFilterArray,
  toCommaJoined,
  idListOrDiff,
  entityId,
} from "../schemas.js";

/** Creatable via API. BUDGET_ALL is a read-only legacy type — listable but not creatable. */
const CREATABLE_BUDGET_TYPES = ["BUDGET_INTERVAL_WEEK", "BUDGET_INTERVAL_MONTH", "BUDGET_INTERVAL_YEAR", "BUDGET_CUSTOM"] as const;
const ALL_BUDGET_TYPES = [...CREATABLE_BUDGET_TYPES, "BUDGET_ALL"] as const;

const limitOverrideItem = z
  .object({
    period: z.string().describe("Starting period this override applies from: YYYY-MM (monthly), YYYY-Www (weekly), or YYYY (yearly). Must be >= the current period."),
    limit: z.number().optional().describe("New spending limit for this period onward, must be > 0. Mutually exclusive with setBaseline."),
    setBaseline: z.boolean().optional().describe("If true, reverts to the budget's baseline limit at this period. Mutually exclusive with limit."),
  })
  .refine((v) => !(v.limit !== undefined && v.setBaseline !== undefined), {
    message: "limit and setBaseline are mutually exclusive — set at most one.",
  });

const updateBudgetItem = z.object({
  id: entityId.describe("ID of the budget to update."),
  name: z.string().max(80).optional(),
  resetLimit: z
    .number()
    .optional()
    .describe("Clears ALL period overrides (past + future) and sets this as the uniform baseline limit. Works on all budget types."),
  limitOverrides: z
    .array(limitOverrideItem)
    .max(50)
    .optional()
    .describe("Up to 50 period-specific overrides; replaces all current+future overrides. Not allowed on BUDGET_CUSTOM. Combines with resetLimit (resetLimit applies first)."),
  accountIds: idListOrDiff.optional().describe("Accounts to track."),
  categoryIds: idListOrDiff.optional().describe("Categories to track (system or custom)."),
  labelIds: idListOrDiff.optional().describe("Labels to filter tracked transactions by."),
  closed: z.boolean().optional().describe("true closes the budget (auto-sets closedDate to today UTC); false reopens it (clears closedDate)."),
  startDate: z.string().optional().describe("YYYY-MM-DD. Only patchable on BUDGET_CUSTOM."),
  endDate: z.string().optional().describe("YYYY-MM-DD. Only patchable on BUDGET_CUSTOM."),
});

export function registerBudgetTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_budgets",
    {
      title: "List budgets",
      description: "List spending budgets and their tracked scope. Newest first by default.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        currencyCode: z.string().optional().describe("ISO 4217 code, exact match, case-insensitive."),
        closed: z.boolean().optional().describe("true = closed only, false = open only, omit = both."),
        type: z.enum(ALL_BUDGET_TYPES).optional(),
        labelId: entityId.optional(),
        accountId: entityId.optional(),
        categoryId: commaListFilter.describe('Category ID(s). Special value "unknown" expands to Unknown income/expense + Uncategorized. Max 10 values.'),
        startDate: rangeFilter.describe("Budget start date range, up to 2 conditions."),
        endDate: rangeFilter.describe("Budget end date range, up to 2 conditions."),
        spending: z
          .enum(["none", "current", "current+2", "current+5", "current+10", "current+25"])
          .optional()
          .describe('Depth of spending data included per budget. "none" (default) = no spending data; "current+N" = current period plus N past periods.'),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/budgets", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            currencyCode: params.currencyCode,
            closed: params.closed,
            type: params.type,
            labelId: params.labelId,
            accountId: params.accountId,
            categoryId: toCommaJoined(params.categoryId),
            startDate: toFilterArray(params.startDate),
            endDate: toFilterArray(params.endDate),
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
            spending: params.spending,
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_budget",
    {
      title: "Get budget",
      description: "Fetch a single budget by ID (filters the list endpoint by id — there's no dedicated single-budget path).",
      inputSchema: {
        id: entityId.describe("Budget ID."),
        spending: z
          .enum(["none", "current", "current+2", "current+5", "current+10", "current+25"])
          .optional()
          .describe("Depth of spending data to include. Default none."),
      },
    },
    async ({ id, spending }, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/budgets", { token: requestToken(extra), query: { id, spending } }),
      ),
  );

  server.registerTool(
    "wallet_create_budget",
    {
      title: "Create budget",
      description:
        "Create a new spending budget scoped to a recurring interval (week/month/year) or a custom date range, " +
        "optionally restricted to specific accounts, categories, and/or labels.",
      inputSchema: {
        name: z.string().describe("Budget display name."),
        currencyCode: z.string().describe("3-letter ISO 4217 currency code."),
        type: z.enum(CREATABLE_BUDGET_TYPES).describe("Immutable after creation. BUDGET_CUSTOM requires startDate and endDate."),
        limit: z.number().positive().describe("Spending limit; must be > 0."),
        startDate: z.string().optional().describe("YYYY-MM-DD. Required for BUDGET_CUSTOM."),
        endDate: z.string().optional().describe("YYYY-MM-DD. Required for BUDGET_CUSTOM."),
        categoryIds: z.array(entityId).optional().describe("Categories to track (system or custom); omit for all."),
        accountIds: z.array(entityId).optional().describe("Accounts to track; omit for all."),
        labelIds: z.array(entityId).optional().describe("Labels to filter tracked transactions by."),
      },
    },
    async (input, extra) => runTool(() => walletRequest("POST", "/v1/api/budgets", { token: requestToken(extra), body: input })),
  );

  server.registerTool(
    "wallet_update_budgets",
    {
      title: "Update budgets",
      description:
        "Patch up to 10 budgets in one call — rename, close/reopen, adjust limits (uniform or per-period), or " +
        "change tracked accounts/categories/labels. Returns HTTP 200 on full success or 207 with per-item " +
        "success/error details otherwise.",
      inputSchema: {
        budgets: z.array(updateBudgetItem).min(1).max(10).describe("Up to 10 partial budget updates, each with an id."),
        returnData: z.boolean().optional().describe("Set false to omit each updated budget's full body. Default true."),
      },
    },
    async ({ budgets, returnData }, extra) =>
      runTool(() =>
        walletRequest("PATCH", "/v1/api/budgets", { token: requestToken(extra), query: { returnData }, body: budgets }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_budgets",
    type: "budgets",
    title: "Delete budgets",
    description: "Delete up to 10 budgets by ID. Budgets aren't referenced by other entities, so they're always deletable.",
  });
}
