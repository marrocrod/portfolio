// Shared request checks for the voice API routes.

import "server-only";

import { consumeDailyBudget, rateLimit } from "./rate-limit";

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function jsonError(status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, message, ...extra }, { status });
}

/**
 * Rejects cross-site requests. Browsers always send Origin on POST, so a missing or
 * foreign Origin means the call does not come from this site's pages.
 */
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return jsonError(403, "forbidden", "Requests must come from this site.");
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    // fall through
  }
  return jsonError(403, "forbidden", "Requests must come from this site.");
}

interface GuardOptions {
  name: string;
  perMinute: number;
  perDay: number;
  /** Site-wide daily cap on the number of requests to this route. */
  globalPerDay: number;
}

/** Origin check, per-IP limits and a global daily cap. Returns an error response or null. */
export async function guard(req: Request, opts: GuardOptions): Promise<Response | null> {
  const originError = checkOrigin(req);
  if (originError) return originError;

  const ip = clientIp(req);
  for (const [max, window] of [
    [opts.perMinute, "1 m"],
    [opts.perDay, "1 d"],
  ] as const) {
    const res = await rateLimit(opts.name, ip, max, window);
    if (!res.ok) {
      return jsonError(429, "rate_limited", "Too many requests. Wait a moment and try again.", {
        retryAfter: res.retryAfter,
      });
    }
  }
  if (!(await consumeDailyBudget(`${opts.name}:requests`, 1, opts.globalPerDay))) {
    return jsonError(429, "daily_limit", "The demo has reached its daily limit. Try again tomorrow.");
  }
  return null;
}
