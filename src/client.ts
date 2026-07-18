const BASE_URL = "https://rest.budgetbakers.com/wallet";

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

function getToken(): string {
  const token = process.env.WALLET_API_TOKEN;
  if (!token) {
    throw new Error(
      "WALLET_API_TOKEN environment variable is not set. Generate a token at " +
        "https://web.budgetbakers.com/settings/rest-api (Wallet Premium required) " +
        "and set it in the MCP server's environment.",
    );
  }
  return token;
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
  const token = getToken();
  const url = `${BASE_URL}${path}${options.query ? buildQuery(options.query) : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
