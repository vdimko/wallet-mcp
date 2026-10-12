/**
 * Runtime configuration, read from the environment.
 *
 * Everything here is read per call rather than cached at import time so tests
 * and probes can flip a variable between requests without restarting.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function trimmed(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * The endpoint's access secret. REQUIRED — the server refuses to start without
 * it, because an unauthenticated local HTTP endpoint that fronts a financial
 * account is a write-capable proxy for anything on the machine.
 */
export function authToken(): string | undefined {
  return trimmed("WALLET_MCP_AUTH_TOKEN");
}

/**
 * The Wallet API token the server itself may hold. Optional: when set, callers
 * that don't send their own `X-Wallet-Token` use this one. Never used as an
 * unauthenticated fallback — see `requireAccessToken`.
 */
export function serverWalletToken(): string | undefined {
  return trimmed("WALLET_API_TOKEN");
}

/** Refuse every mutating Wallet API call, regardless of what the caller asks for. */
export function readonlyMode(): boolean {
  return TRUTHY.has((process.env.WALLET_MCP_READONLY ?? "").trim().toLowerCase());
}

/** Per-request timeout for outbound Wallet API calls. */
export function timeoutMs(): number {
  const raw = Number(process.env.WALLET_MCP_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/** Origins allowed to drive the endpoint. Empty = reject every request that has one. */
export function allowedOrigins(): string[] {
  return (process.env.WALLET_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Host header values accepted by the transport's DNS-rebinding guard. */
export function allowedHosts(host: string, port: number): string[] {
  const explicit = (process.env.WALLET_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  return [`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** True when the bind address is reachable from outside this machine. */
export function isNetworkExposed(host: string): boolean {
  return !["127.0.0.1", "localhost", "::1"].includes(host);
}

/** Maximum accepted request body size (an MCP JSON-RPC frame is a few KB). */
export function bodyLimit(): string {
  return trimmed("WALLET_MCP_MAX_BODY") ?? "256kb";
}
