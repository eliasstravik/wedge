export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export interface RateLimiter {
  checkAndIncrement(input: { ip: string; limit: number }): Promise<RateLimitResult>
}

type Bucket = {
  count: number
  resetAtMs: number
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  async checkAndIncrement(input: { ip: string; limit: number }): Promise<RateLimitResult> {
    const now = Date.now()
    const key = input.ip || "unknown"
    const current = this.buckets.get(key)

    if (!current || current.resetAtMs <= now) {
      this.buckets.set(key, { count: 1, resetAtMs: now + 60_000 })
      return { allowed: true }
    }

    if (current.count >= input.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)),
      }
    }

    current.count += 1
    return { allowed: true }
  }
}
