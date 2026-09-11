// Rate limiting and daily budgets for the paid API routes.
// Uses Upstash Redis when configured; otherwise falls back to an in-memory store,
// which is fine for local development but only per-instance on Vercel.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Window = `${number} ${"s" | "m" | "h" | "d"}`;

export interface LimitResult {
  ok: boolean;
  /** Seconds until the caller may retry. */
  retryAfter: number;
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

if (!redis && process.env.NODE_ENV === "production") {
  console.warn("[rate-limit] Upstash Redis is not configured; using per-instance in-memory limits.");
}

const WINDOW_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function windowMs(w: Window): number {
  const [n, unit] = w.split(" ");
  return Number(n) * WINDOW_MS[unit];
}

// ---------------------------------------------------------------- in-memory fallback

const hits = new Map<string, number[]>();
const counters = new Map<string, number>();

function memoryLimit(key: string, max: number, ms: number): LimitResult {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfter: Math.ceil((recent[0] + ms - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfter: 0 };
}

// ---------------------------------------------------------------- public API

const limiters = new Map<string, Ratelimit>();

/** Sliding-window limit of `max` requests per `window` for one identifier. */
export async function rateLimit(name: string, id: string, max: number, window: Window): Promise<LimitResult> {
  const key = `${name}:${max}:${window}`;
  if (!redis) return memoryLimit(`${key}:${id}`, max, windowMs(window));

  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(max, window), prefix: `rl:${name}` });
    limiters.set(key, limiter);
  }
  const res = await limiter.limit(id);
  return { ok: res.success, retryAfter: res.success ? 0 : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Adds `amount` to a site-wide daily counter and reports whether it stayed within `max`.
 * Protects against runaway costs even if many different IPs use the demo.
 */
export async function consumeDailyBudget(name: string, amount: number, max: number): Promise<boolean> {
  const key = `budget:${name}:${today()}`;
  if (!redis) {
    const next = (counters.get(key) ?? 0) + amount;
    if (next > max) return false;
    counters.set(key, next);
    return true;
  }
  const next = await redis.incrby(key, amount);
  if (next === amount) await redis.expire(key, 2 * 86_400);
  if (next > max) {
    // Give the amount back so a rejected request doesn't eat into the budget.
    await redis.decrby(key, amount);
    return false;
  }
  return true;
}

/** Test helper: clears the in-memory store. */
export function resetMemoryLimits() {
  hits.clear();
  counters.clear();
}
