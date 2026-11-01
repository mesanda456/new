export interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  limit: number;
  /** Window duration in milliseconds (e.g. 60_000 for 1 minute) */
  windowMs: number;
  /** Optional burst allowance multiplier (1.0 = strict, 1.2 = 20% burst) */
  burstFactor?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  currentWeight: number;
  resetAtMs: number;
  retryAfterMs: number;
  headers: {
    'X-RateLimit-Limit': string;
    'X-RateLimit-Remaining': string;
    'X-RateLimit-Reset': string;
    'Retry-After'?: string;
  };
}

interface WindowBucket {
  previousCount: number;
  currentCount: number;
  currentWindowStart: number;
}

/**
 * High-precision Sliding Window Counter Rate Limiter (Cloudflare / Envoy style).
 *
 * Uses O(1) memory per key by interpolating between the previous fixed window and the
 * current fixed window based on the elapsed fraction of the current window:
 *   weight = previousCount * (1 - elapsedFraction) + currentCount
 */
export class SlidingWindowRateLimiter {
  private buckets = new Map<string, WindowBucket>();

  public evaluate(
    key: string,
    config: RateLimitConfig,
    nowMs: number = Date.now(),
    cost: number = 1
  ): RateLimitDecision {
    const { limit, windowMs, burstFactor = 1.0 } = config;
    const effectiveLimit = Math.floor(limit * burstFactor);
    const currentWindowStart = Math.floor(nowMs / windowMs) * windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        previousCount: 0,
        currentCount: 0,
        currentWindowStart,
      };
      this.buckets.set(key, bucket);
    } else if (currentWindowStart > bucket.currentWindowStart) {
      const windowsElapsed = (currentWindowStart - bucket.currentWindowStart) / windowMs;
      bucket.previousCount = windowsElapsed === 1 ? bucket.currentCount : 0;
      bucket.currentCount = 0;
      bucket.currentWindowStart = currentWindowStart;
    }

    const elapsedInCurrentWindow = nowMs - currentWindowStart;
    const elapsedFraction = Math.min(1, Math.max(0, elapsedInCurrentWindow / windowMs));
    const previousWeight = bucket.previousCount * (1 - elapsedFraction);
    const projectedWeight = previousWeight + bucket.currentCount + cost;

    const resetAtMs = currentWindowStart + windowMs;
    const retryAfterMs = Math.max(0, resetAtMs - nowMs);

    if (projectedWeight > effectiveLimit) {
      return {
        allowed: false,
        key,
        limit: effectiveLimit,
        remaining: 0,
        currentWeight: Number((previousWeight + bucket.currentCount).toFixed(2)),
        resetAtMs,
        retryAfterMs,
        headers: {
          'X-RateLimit-Limit': String(effectiveLimit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetAtMs / 1000)),
          'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        },
      };
    }

    bucket.currentCount += cost;
    const updatedWeight = previousWeight + bucket.currentCount;
    const remaining = Math.max(0, Math.floor(effectiveLimit - updatedWeight));

    return {
      allowed: true,
      key,
      limit: effectiveLimit,
      remaining,
      currentWeight: Number(updatedWeight.toFixed(2)),
      resetAtMs,
      retryAfterMs: 0,
      headers: {
        'X-RateLimit-Limit': String(effectiveLimit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetAtMs / 1000)),
      },
    };
  }

  public getBucketSnapshot(key: string, config: RateLimitConfig, nowMs: number = Date.now()) {
    return this.evaluate(key, config, nowMs, 0);
  }

  public resetKey(key: string): void {
    this.buckets.delete(key);
  }

  public resetAll(): void {
    this.buckets.clear();
  }
}

