import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool } from "./shared.js";
import { commonListParams, timestampFilters, textFilter, toFilterArray, entityId } from "../schemas.js";

/** Automatic record-categorization rules. Read + delete only via this API — no create/update endpoint. */
export function registerRecordRuleTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_record_rules",
    {
      title: "List record rules",
      description:
        "List automatic categorization rules for records (keyword-match -> category/account/labels). Read-only " +
        "for create/edit — this API can only list and delete rules. Newest first by default.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        labelId: entityId.optional(),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/record-rules", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            labelId: params.labelId,
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_record_rule",
    {
      title: "Get record rule",
      description: "Fetch a single record rule by ID (filters the list endpoint by id).",
      inputSchema: { id: entityId.describe("Record rule ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/record-rules", { token: requestToken(extra), query: { id } })),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_record_rules",
    type: "record-rules",
    title: "Delete record rules",
    description: "Delete up to 10 record rules by ID. Not referenced by other entities, so always deletable.",
  });
}
