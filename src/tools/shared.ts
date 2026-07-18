import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { walletRequest } from "../client.js";
import { runTool, requestToken, type ToolExtra } from "../format.js";
import { entityId } from "../schemas.js";

/** Registers a `DELETE /v1/api/{type}` tool — body-based, up to 10 IDs, shared across resources. */
export function registerDeleteTool(
  server: McpServer,
  opts: { name: string; type: string; title: string; description: string },
): void {
  server.registerTool(
    opts.name,
    {
      title: opts.title,
      description: opts.description,
      inputSchema: {
        ids: z.array(entityId).min(1).max(10).describe(`Up to 10 ${opts.type} IDs to delete.`),
      },
    },
    async ({ ids }: { ids: string[] }, extra: ToolExtra) =>
      runTool(() =>
        walletRequest("DELETE", `/v1/api/${opts.type}`, { token: requestToken(extra), body: { ids } }),
      ),
  );
}

/** Registers a `GET /v1/api/{type}/references` tool — shared across categories/records/accounts/labels. */
export function registerReferencesTool(
  server: McpServer,
  opts: { name: string; type: string; title: string; description: string },
): void {
  server.registerTool(
    opts.name,
    {
      title: opts.title,
      description: opts.description,
      inputSchema: {
        ids: z.array(entityId).min(1).max(20).describe("Up to 20 entity IDs to check (comma-joined server-side)."),
      },
    },
    async ({ ids }: { ids: string[] }, extra: ToolExtra) =>
      runTool(() =>
        walletRequest("GET", `/v1/api/${opts.type}/references`, {
          token: requestToken(extra),
          query: { id: ids.join(",") },
        }),
      ),
  );
}
