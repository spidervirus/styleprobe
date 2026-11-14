/**
 * In-memory sliding-window rate limiter for Next.js API routes.
 * Prevents denial of service and API abuse on the public playground.
 */

interface RateLimitRecord {
  timestamps: number[];
}

class SlidingWindowRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private windowMs: number;
  private maxRequests: number;
  private lastCleanup: number = Date.now();

  constructor(options: { windowMs?: number; maxRequests?: number } = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 60 seconds
    this.maxRequests = options.maxRequests || 10;   // 10 requests per window
  }

  public check(identifier: string): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();

    // Periodic cleanup of stale entries every 60 seconds to prevent memory leak
    if (now - this.lastCleanup > 60000) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    let record = this.records.get(identifier);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(identifier, record);
    }

    // Filter out timestamps outside the sliding window
    const windowStart = now - this.windowMs;
    record.timestamps = record.timestamps.filter(ts => ts > windowStart);

    if (record.timestamps.length >= this.maxRequests) {
      const oldest = record.timestamps[0];
      const resetMs = Math.max(0, oldest + this.windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        resetMs
      };
    }

    record.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - record.timestamps.length,
      resetMs: this.windowMs
    };
  }

  private cleanup(now: number) {
    const windowStart = now - this.windowMs;
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter(ts => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
      }
    }
  }
}

// Global singleton instance so it persists across hot reloads and serverless function warm instances
const globalLimiter = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 10      // 10 requests per minute per IP
});

export function checkRateLimit(ip: string) {
  return globalLimiter.check(ip);
}
