/**
 * Rate limiting behind an interface, deliberately.
 *
 * HONEST LIMITATION, stated here because it belongs in the code and not only in a doc:
 * `MemoryRateLimiter` is per-process. On a stateless host (Lambda, multiple containers)
 * every instance holds its own counters, so with N concurrent instances the effective
 * limit is N x `limit`. That is fine for a local stdio server, where there is exactly
 * one process, and it is NOT a real ceiling for a hosted deployment.
 *
 * For a hosted deployment, put the blunt ceiling at the edge (API Gateway usage plan or
 * a WAF rate rule) and, if per-client fairness is wanted, implement `RateLimiter` against
 * a shared store (DynamoDB with a conditional counter). That is a deploy-time decision;
 * nothing above this interface changes.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(clientId: string): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 60,
    private readonly windowMs = 60_000,
  ) {}

  async check(clientId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(clientId) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      this.hits.set(clientId, recent);
      return { allowed: false, remaining: 0, resetAt: oldest + this.windowMs };
    }

    recent.push(now);
    this.hits.set(clientId, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // crude bound; a shared store has none of this
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      resetAt: now + this.windowMs,
    };
  }
}

/** Explicit opt-out, so "no limiting" is a visible choice rather than an omission. */
export class NoopRateLimiter implements RateLimiter {
  async check(): Promise<RateLimitResult> {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
  }
}
