import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Lazy singleton — instantiated on first use so the module is safe to import
// in environments where Upstash env vars are not set (e.g. local dev without
// Redis). Callers should call `getRedis()` and handle `null`.

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(
        "[redis] UPSTASH_REDIS_REST_URL/TOKEN not set — Redis features (rate limiting, idempotency) are disabled."
      );
    }
    cached = null;
    return cached;
  }
  cached = new Redis({ url, token });
  return cached;
}

// PIN verify rate limit: 5 attempts per 10 minutes per session_id.
// Returns null if Redis is not configured (caller should skip rate limiting).
let pinLimiterCached: Ratelimit | null | undefined;
export function getPinRatelimit(): Ratelimit | null {
  if (pinLimiterCached !== undefined) return pinLimiterCached;
  const redis = getRedis();
  if (!redis) {
    pinLimiterCached = null;
    return pinLimiterCached;
  }
  pinLimiterCached = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "10 m"),
    analytics: false,
    prefix: "rl:verify-pin",
  });
  return pinLimiterCached;
}

// Simple ping helper for /api/health.
export async function pingRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const pong = await redis.ping();
    return pong === "PONG" || pong === "pong";
  } catch {
    return false;
  }
}
