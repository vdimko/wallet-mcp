import { WalletApiError, tokenFromHeaders, type WalletResponse } from "./client.js";

export interface ToolExtra {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}

/** Pulls the caller's Wallet API token off the current MCP request's Authorization header. */
export function requestToken(extra: ToolExtra): string | undefined {
  return tokenFromHeaders(extra.requestInfo?.headers);
}

export interface ToolTextResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function jsonContent(data: unknown, rateLimitRemaining?: number): ToolTextResult {
  const text =
    rateLimitRemaining === undefined
      ? JSON.stringify(data, null, 2)
      : `${JSON.stringify(data, null, 2)}\n\n⚠️ Wallet API rate limit low: ${rateLimitRemaining} requests remaining this hour.`;
  return { content: [{ type: "text", text }] };
}

function errorContent(err: unknown): ToolTextResult {
  if (err instanceof WalletApiError) {
    const bodyText = typeof err.body === "string" ? err.body : JSON.stringify(err.body, null, 2);
    return {
      content: [{ type: "text", text: `Wallet API error (HTTP ${err.status}): ${err.message}\n${bodyText}` }],
      isError: true,
    };
  }
  return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
}

/** Wraps a Wallet API call so tool handlers only need to describe the request. */
export async function runTool<T>(fn: () => Promise<WalletResponse<T>>): Promise<ToolTextResult> {
  try {
    const res = await fn();
    return jsonContent(res.data, res.rateLimitRemaining);
  } catch (err) {
    return errorContent(err);
  }
}
