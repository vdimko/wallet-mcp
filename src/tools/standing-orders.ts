import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";
import { registerDeleteTool } from "./shared.js";
import { commonListParams, timestampFilters, textFilter, rangeFilter, toFilterArray, entityId } from "../schemas.js";

/**
 * Wallet's recurring-payment feature. Read + delete only via this API — there's no
 * create/update endpoint, so new standing orders or edits must be made in the Wallet app itself.
 */
export function registerStandingOrderTools(server: McpServer): void {
  server.registerTool(
    "wallet_list_standing_orders",
    {
      title: "List standing orders",
      description:
        "List recurring payments (rent, subscriptions, etc). Each has a recurrenceRule (RRULE format), dueDate, " +
        "and reminder settings. Read-only via this API — creating or editing one requires the Wallet app. Newest first by default.",
      inputSchema: {
        ...commonListParams,
        ...timestampFilters,
        name: textFilter,
        currencyCode: z.string().optional().describe("ISO 4217 code, exact match, case-insensitive."),
        labelId: entityId.optional(),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/standing-orders", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            id: params.id,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            name: toFilterArray(params.name),
            currencyCode: params.currencyCode,
            labelId: params.labelId,
            createdAt: toFilterArray(params.createdAt),
            updatedAt: toFilterArray(params.updatedAt),
          },
        }),
      ),
  );

  server.registerTool(
    "wallet_get_standing_order",
    {
      title: "Get standing order",
      description: "Fetch a single standing order by ID (filters the list endpoint by id).",
      inputSchema: { id: entityId.describe("Standing order ID.") },
    },
    async ({ id }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/standing-orders", { token: requestToken(extra), query: { id } })),
  );

  server.registerTool(
    "wallet_list_standing_order_items",
    {
      title: "List standing order occurrences",
      description:
        "List individual occurrences (periods) of standing orders — each tracks its due/paid/dismissed status " +
        "and the recordIds of whatever transaction(s) settled it. Use this for payment history / upcoming-due views.",
      inputSchema: {
        limit: commonListParams.limit,
        offset: commonListParams.offset,
        agentHints: commonListParams.agentHints,
        withTotal: commonListParams.withTotal,
        standingOrderId: entityId.optional().describe("Only occurrences of this standing order; omit for all."),
        originalDate: rangeFilter.describe("Filter by the occurrence's originally-scheduled date. Up to 2 conditions."),
        dismissed: z.boolean().optional(),
        recordId: entityId.optional().describe("Only the occurrence(s) settled by this record."),
        paidDate: rangeFilter.describe("Filter by when the occurrence was paid. Up to 2 conditions."),
      },
    },
    async (params, extra) =>
      runTool(() =>
        walletRequest("GET", "/v1/api/standing-orders/items", {
          token: requestToken(extra),
          query: {
            limit: params.limit,
            offset: params.offset,
            agentHints: params.agentHints,
            withTotal: params.withTotal,
            standingOrderId: params.standingOrderId,
            originalDate: toFilterArray(params.originalDate),
            dismissed: params.dismissed,
            recordId: params.recordId,
            paidDate: toFilterArray(params.paidDate),
          },
        }),
      ),
  );

  registerDeleteTool(server, {
    name: "wallet_delete_standing_orders",
    type: "standing-orders",
    title: "Delete standing orders",
    description: "Delete up to 10 standing orders by ID. Not referenced by other entities, so always deletable.",
  });
}
