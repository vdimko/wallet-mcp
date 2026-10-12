import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { allowedOrigins, authToken } from "./config.js";

/**
 * Constant-time comparison. Hashing both sides first makes it length-independent,
 * so `timingSafeEqual` never throws on a mismatched-length guess and the compare
 * leaks neither the secret's content nor its length.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function bearerValue(header: unknown): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return (match ? match[1] : raw).trim() || undefined;
}

function deny(res: Parameters<RequestHandler>[1], status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32001, message },
    id: null,
  });
}

/**
 * Gate every request behind the access secret, presented as
 * `Authorization: Bearer <WALLET_MCP_AUTH_TOKEN>`.
 *
 * This header used to carry the Wallet API token; it no longer does. The access
 * secret is never forwarded to BudgetBakers — per-caller Wallet tokens travel in
 * `X-Wallet-Token` instead (see `walletTokenFromHeaders`).
 */
export const requireAccessToken: RequestHandler = (req, res, next) => {
  const expected = authToken();
  const provided = bearerValue(req.headers.authorization);
  if (!expected || !provided || !secretMatches(provided, expected)) {
    deny(res, 401, "Unauthorized: missing or invalid access token.");
    return;
  }
  next();
};

/**
 * Deny any request carrying an `Origin` header that isn't explicitly allowed.
 *
 * A well-behaved MCP client (Hermes, Claude Code, curl) sends no Origin at all.
 * A present Origin means a browser page is driving the request — the
 * DNS-rebinding shape, where an attacker domain re-resolves to 127.0.0.1 and
 * then talks to this endpoint same-origin. Deny by default; opt in with
 * WALLET_MCP_ALLOWED_ORIGINS when a browser-based client genuinely needs it.
 */
export const rejectForeignOrigins: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin === undefined) {
    next();
    return;
  }
  if (allowedOrigins().includes(origin)) {
    next();
    return;
  }
  deny(res, 403, `Forbidden: origin not allowed (${origin}).`);
};
