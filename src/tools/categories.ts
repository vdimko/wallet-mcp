import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool } from "../format.js";
import { pagination, colorHint, uuid } from "../schemas.js";

const CARDINALITY = ["none", "must", "need", "want"] as const;

const updateCategoryItem = z.object({
  id: uuid.describe("ID of the category to update."),
  name: z.string().max(80).optional().describe("New name, max 80 characters."),
  resetName: z
    .boolean()
    .optional()
    .describe("Reset a base (system) category's name back to its default. Base categories only."),
  color: z.string().optional().describe(colorHint),
  cardinality: z.enum(CARDINALITY).optional().describe("Need-vs-want classification used in some Wallet reports."),
});

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_categories",
    {
      title: "List categories",
      description: "List spending categories, including both system (built-in) and custom categories.",
      inputSchema: { ...pagination },
    },
    async ({ limit, offset }) => runTool(() => walletRequest("GET", "/categories", { query: { limit, offset } })),
  );

  server.registerTool(
    "wallet_get_category",
    {
      title: "Get category",
      description: "Fetch a single category by ID.",
      inputSchema: { id: uuid.describe("Category ID.") },
    },
    async ({ id }) => runTool(() => walletRequest("GET", `/categories/${id}`)),
  );

  server.registerTool(
    "wallet_create_category",
    {
      title: "Create custom category",
      description: "Create a new custom category nested under an existing system category.",
      inputSchema: {
        name: z.string().max(80).describe("Category name, max 80 characters, unique case-insensitively."),
        parentId: uuid.describe("ID of the system (built-in) category to nest this under."),
        color: z.string().optional().describe(colorHint),
        cardinality: z.enum(CARDINALITY).optional(),
      },
    },
    async (input) => runTool(() => walletRequest("POST", "/categories/custom", { body: input })),
  );

  server.registerTool(
    "wallet_update_categories",
    {
      title: "Update categories",
      description:
        "Patch up to 10 categories in one call. Returns HTTP 200 on full success or 207 with per-item " +
        "success/error details on partial failure.",
      inputSchema: {
        categories: z
          .array(updateCategoryItem)
          .min(1)
          .max(10)
          .describe("Up to 10 partial category updates, each with an id."),
      },
    },
    async ({ categories }) => runTool(() => walletRequest("PATCH", "/categories", { body: categories })),
  );

  server.registerTool(
    "wallet_delete_categories",
    {
      title: "Delete categories",
      description:
        "Delete up to 10 custom categories by ID. System categories cannot be deleted, and a category must " +
        "have no references (records/budgets using it) before it can be deleted — check with " +
        "wallet_category_references first.",
      inputSchema: {
        ids: z.array(uuid).min(1).max(10).describe("Up to 10 custom category IDs to delete."),
      },
    },
    async ({ ids }) =>
      runTool(() => walletRequest("DELETE", "/v1/api/categories", { query: { id: ids.join(",") } })),
  );

  server.registerTool(
    "wallet_category_references",
    {
      title: "Check category references",
      description:
        "List entities (records, budgets, etc.) that reference a category — useful to check before deleting it.",
      inputSchema: { id: uuid.describe("Category ID to check.") },
    },
    async ({ id }) => runTool(() => walletRequest("GET", "/categories/references", { query: { id } })),
  );
}
