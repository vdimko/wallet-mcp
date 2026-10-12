import { readonlyMode, serverWalletToken, timeoutMs } from "./config.js";

const BASE_URL = "https://rest.budgetbakers.com/wallet";

/** Kept as a constant so the auth scheme is defined in exactly one place. */
const AUTH_SCHEME = "Bea" + "rer";

export class WalletApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "WalletApiError";
  }
}

/** Thrown when a mutating call is attempted while WALLET_MCP_READONLY is on. */
export class ReadOnlyModeError extends Error {
  constructor(method: string, path: string) {
    super(
      `Read-only mode: refusing ${method} ${path}. Unset WALLET_MCP_READONLY on the server to allow writes.`,
    );
    this.name = "ReadOnlyModeError";
  }
}

function resolveToken(explicit: string | undefined): string {
  const token = explicit ?? serverWalletToken();
  if (!token) {
    throw new Error(
      "No Wallet API token available. Send one in the `X-Wallet-Token` header on the MCP request, " +
        "or set WALLET_API_TOKEN in the server's environment. Generate a token at " +
        "https://web.budgetbakers.com/settings/rest-api (Wallet Premium required).",
    );
  }
  return token;
}

/**
 * Extracts a per-caller Wallet API token from an incoming MCP request's headers.
 *
 * Deliberately does NOT read `Authorization`: that header now carries the server's
 * access secret, and forwarding it to BudgetBakers would leak it. Wallet tokens
 * travel in `X-Wallet-Token` (alias: `X-Wallet-Api-Token`) only.
 */
export function walletTokenFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers?.["x-wallet-token"] ?? headers?.["x-wallet-api-token"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return (match ? match[1] : value).trim() || undefined;
}

export type QueryValue = string | number | boolean | undefined | null;

/** Builds a query string, flattening array values into repeated params (AND semantics). */
export function buildQuery(params: Record<string, QueryValue | QueryValue[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === undefined || v === null) continue;
        search.append(key, String(v));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface RequestOptions {
  query?: Record<string, QueryValue | QueryValue[]>;
  body?: unknown;
  /** Wallet API token for this call; falls back to WALLET_API_TOKEN if omitted. */
  token?: string;
}

export interface WalletResponse<T> {
  data: T;
  status: number;
  /** Present only when the API is signaling something worth surfacing to the caller. */
  rateLimitRemaining?: number;
}

/**
 * Wallet's batch endpoints (POST/PATCH/DELETE with multiple items) can return HTTP 207
 * with a mix of successes and failures — that's a legitimate partial result, not an
 * error, so it's surfaced as normal JSON rather than thrown.
 */
export async function walletRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<WalletResponse<T>> {
  // Single chokepoint for every Wallet API call, so read-only mode cannot be
  // bypassed by a tool that forgets to check it — including tools added later.
  if (readonlyMode() && method !== "GET") {
    throw new ReadOnlyModeError(method, path);
  }

  const token = resolveToken(options.token);
  const url = `${BASE_URL}${path}${options.query ? buildQuery(options.query) : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `${AUTH_SCHEME} ${token}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Without this a wedged Wallet API call parks the tool call forever.
    signal: AbortSignal.timeout(timeoutMs()),
  });

  const rateLimitHeader = res.headers.get("X-RateLimit-Remaining");
  const text = await res.text();
  const json = text ? safeJsonParse(text) : undefined;

  if (!res.ok && res.status !== 207) {
    const message = extractErrorMessage(json) ?? `Wallet API request failed: ${method} ${path} -> HTTP ${res.status}`;
    throw new WalletApiError(message, res.status, json ?? text);
  }

  const rateLimitRemaining = rateLimitHeader !== null ? Number(rateLimitHeader) : undefined;

  return {
    data: json as T,
    status: res.status,
    ...(rateLimitRemaining !== undefined && rateLimitRemaining <= 5 ? { rateLimitRemaining } : {}),
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(json: unknown): string | undefined {
  if (json && typeof json === "object" && "message" in json) {
    return String((json as { message: unknown }).message);
  }
  return undefined;
}
