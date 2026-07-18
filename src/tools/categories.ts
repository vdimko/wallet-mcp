import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool, registerReferencesTool } from "./shared.js";
import { commonListParams, timestampFilters, textFilter, toFilterArray, colorSchema, entityId } from "../schemas.js";

const CARDINALITY = ["none", "must", "need", "want"] as const;

const updateCategoryItem = z
  .object({
    id: entityId.describe("ID of the category to update (system or custom)."),
    name: z.string().max(80).optional().describe("New name (sets customName=true). Mutually exclusive with resetName."),
    resetName: z
      .boolean()
      .optional()
      .describe("Reset a base (system) category's name to its default (sets customName=false). Base categories only. Mutually exclusive with name."),
    color: colorSchema.optional(),
    cardinality: z.enum(CARDINALITY).optional().describe('Need-vs-want classification. "none" clears it.'),
  })
  .refine((v) => !(v.name !== undefined && v.resetName !== undefined), {
    message: "name and resetName are mutually exclusive — set at most one.",
  });

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_categories",
    {
      title: "List categories",
      description: "List spending categories, including both system (built-in) and custom categories.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        customCategory: z.boolean().optional().describe("true = custom subcategories only, false = system categories only."),
        archived: z.boolean().optional().describe("true = archived only, false = active only, omit = both."),
        budgetId: entityId.optional().describe("Only categories tracked by this budget."),
        sortBy: z.string().optional().describe('+/- prefixed field: createdAt or updatedAt. Example: "-createdAt".'),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/categories", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
            customCategory: params.customCategory,
            archived: params.archived,
            budgetId: params.budgetId,
            sortBy: params.sortBy,
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_category",
    {
      title: "Get category",
      description: "Fetch a single category by ID (filters the list endpoint by id — there's no dedicated single-category path).",
      inputSchema: { id: entityId.describe("Category ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/categories", { token: requestToken(extra), query: { id } })),
  );

  server.registerTool(
    "wallet_create_category",
    {
      title: "Create custom category",
      description: "Create a new custom subcategory nested under an existing system category.",
      inputSchema: {
        name: z.string().max(80).describe("Category name, max 80 characters."),
        parentId: entityId.describe("System (built-in) category ID to nest this under — use wallet_list_categories to find one."),
        color: colorSchema.optional().describe("Defaults to the parent's color if omitted."),
        cardinality: z.enum(CARDINALITY).optional().describe("Defaults to the parent's cardinality if omitted."),
      },
    },
    async (input, extra) =>
      runTool(() => walletRequest("POST", "/v1/api/categories/custom", { token: requestToken(extra), body: input })),
  );

  server.registerTool(
    "wallet_update_categories",
    {
      title: "Update categories",
      description:
        "Patch up to 10 categories in one call. Returns HTTP 200 on full success or 207 with per-item " +
        "success/error details otherwise.",
      inputSchema: {
        categories: z.array(updateCategoryItem).min(1).max(10).describe("Up to 10 partial category updates, each with an id."),
        returnData: z.boolean().optional().describe("Set false to omit each updated category's full body. Default true."),
      },
    },
    async ({ categories, returnData }, extra) =>
      runTool(() =>
        walletRequest("PATCH", "/v1/api/categories", { token: requestToken(extra), query: { returnData }, body: categories }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_categories",
    type: "categories",
    title: "Delete categories",
    description:
      "Delete up to 10 custom categories by ID. System categories can't be deleted. Check " +
      "wallet_category_references first — a category with existing references can't be deleted.",
  });

  registerReferencesTool(server, {
    name: "wallet_category_references",
    type: "categories",
    title: "Check category references",
    description: "List records, standing orders, budgets, and record rules that reference given categories.",
  });
}
