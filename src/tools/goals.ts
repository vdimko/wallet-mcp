import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { commonListParams, timestampFilters, textFilter, toFilterArray, entityId } from "../schemas.js";

/** Savings goals. Fully read-only via this API — no create/update/delete endpoint exists. */
export function registerGoalTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_goals",
    {
      title: "List goals",
      description: "List savings goals (target amount, initial amount, desired date, state). Read-only — this API has no way to create/edit/delete goals. Newest first by default.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        note: textFilter,
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/goals", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            note: toFilterArray(params.note),
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_goal",
    {
      title: "Get goal",
      description: "Fetch a single goal by ID (filters the list endpoint by id).",
      inputSchema: { id: entityId.describe("Goal ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/goals", { token: requestToken(extra), query: { id } })),
  );
}
