import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken } from "../format.js";

export function registerApiUsageTools(server: McpServer): void {
  server.registerTool(
    "wallet_api_usage_stats",
    {
      title: "Get API usage stats",
      description:
        "Get REST API usage statistics for the calling token — useful for checking how close you are to the " +
        "300 requests/hour limit. Time ranges use half-open intervals (from inclusive, to exclusive).",
      inputSchema: {
        period: z
          .string()
          .describe(
            'Time period + granularity: "Xdays" -> daily (max 366days), "Xweeks" -> weekly, ISO weeks Monday-start ' +
              '(max 53weeks), "Xmonths" -> monthly (max 13months). Example: "30days".',
          ),
      },
    },
    async ({ period }, extra) =>
      runTool(() => walletRequest("GET", "/v1/api/api-usage/stats", { token: requestToken(extra), query: { period } })),
  );
}
