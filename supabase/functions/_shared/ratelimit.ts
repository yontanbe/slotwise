/**
 * In-memory sliding window rate limiter, keyed per API key.
 * Limits: state lives in one isolate only. Edge Functions run several isolates and recycle them,
 * so the effective limit is per instance, not global. Swap for a Postgres or Redis counter when
 * strict limits matter.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(public limit: number, public windowMs: number, private now: () => number = Date.now) {}

  check(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now()
    const since = t - this.windowMs
    const arr = (this.hits.get(key) ?? []).filter((x) => x > since)
    if (arr.length >= this.limit) {
      this.hits.set(key, arr)
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((arr[0] + this.windowMs - t) / 1000)) }
    }
    arr.push(t)
    this.hits.set(key, arr)
    if (this.hits.size > 10_000) this.gc(since)
    return { ok: true, remaining: this.limit - arr.length, retryAfterSec: 0 }
  }

  private gc(since: number) {
    for (const [k, v] of this.hits) if (!v.some((x) => x > since)) this.hits.delete(k)
  }
}
