import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool, registerReferencesTool } from "./shared.js";
import { commonListParams, timestampFilters, textFilter, toFilterArray, colorSchema, entityId } from "../schemas.js";

const updateLabelItem = z.object({
  id: entityId.describe("ID of the label to update."),
  name: z.string().max(80).optional(),
  color: colorSchema.optional(),
  archived: z.boolean().optional(),
});

export function registerLabelTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_labels",
    {
      title: "List labels",
      description: "List labels/hashtags used to tag records, budgets, standing orders, and record rules. Name-ascending by default.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        archived: z.boolean().optional().describe("true = archived only, false = active only, omit = both."),
        recordId: entityId.optional().describe("Only labels used on this record."),
        budgetId: entityId.optional().describe("Only labels used on this budget."),
        standingOrderId: entityId.optional().describe("Only labels used on this standing order."),
        recordRuleId: entityId.optional().describe("Only labels used on this record rule."),
        sortBy: z.string().optional().describe('+/- prefixed field: createdAt or updatedAt. Example: "-createdAt".'),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/labels", {
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
            archived: params.archived,
            recordId: params.recordId,
            budgetId: params.budgetId,
            standingOrderId: params.standingOrderId,
            recordRuleId: params.recordRuleId,
            sortBy: params.sortBy,
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_label",
    {
      title: "Get label",
      description: "Fetch a single label by ID (filters the list endpoint by id — there's no dedicated single-label path).",
      inputSchema: { id: entityId.describe("Label ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/labels", { token: requestToken(extra), query: { id } })),
  );

  server.registerTool(
    "wallet_create_label",
    {
      title: "Create label",
      description: "Create a new label/hashtag.",
      inputSchema: {
        name: z.string().max(80).describe("Label display name."),
        color: colorSchema.optional().describe("Randomly assigned if omitted."),
      },
    },
    async (input, extra) => runTool(() => walletRequest("POST", "/v1/api/labels", { token: requestToken(extra), body: input })),
  );

  server.registerTool(
    "wallet_update_labels",
    {
      title: "Update labels",
      description:
        "Patch up to 10 labels in one call — rename, recolor, archive/unarchive. Returns HTTP 200 on full " +
        "success or 207 with per-item success/error details otherwise.",
      inputSchema: {
        labels: z.array(updateLabelItem).min(1).max(10).describe("Up to 10 partial label updates, each with an id."),
        returnData: z.boolean().optional().describe("Set false to omit each updated label's full body. Default true."),
      },
    },
    async ({ labels, returnData }, extra) =>
      runTool(() =>
        walletRequest("PATCH", "/v1/api/labels", { token: requestToken(extra), query: { returnData }, body: labels }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_labels",
    type: "labels",
    title: "Delete labels",
    description: "Delete up to 10 labels by ID. Check wallet_label_references first — a label with existing references can't be deleted.",
  });

  registerReferencesTool(server, {
    name: "wallet_label_references",
    type: "labels",
    title: "Check label references",
    description: "List records, standing orders, budgets, record rules, and other entities that reference given labels.",
  });
}
