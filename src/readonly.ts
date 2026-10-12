import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readonlyMode } from "./config.js";

/**
 * Write-shaped tool names. Matching on the verb prefix rather than a fixed list
 * means a mutating tool added later — in this repo or a fork — is hidden by
 * default instead of silently exposed.
 */
const MUTATING_TOOL = /^wallet_(create|update|delete)/;

/**
 * In read-only mode, mutating tools are never registered, so a client (and the
 * LLM behind it) doesn't even see them. This is the hygiene half of read-only
 * mode; the enforcement half lives in `walletRequest`, which refuses every
 * non-GET call regardless of what is registered.
 */
export function applyReadOnlyPolicy(server: McpServer): McpServer {
  if (!readonlyMode()) return server;
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]): unknown => {
          if (MUTATING_TOOL.test(name)) return undefined;
          return (target.registerTool as (...args: unknown[]) => unknown)(name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as McpServer;
}
