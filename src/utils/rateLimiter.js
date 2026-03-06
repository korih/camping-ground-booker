/**
 * Rate limiter using a token bucket algorithm with exponential backoff and jitter.
 * Prevents camping reservation websites from blocking requests.
 */

const DEFAULT_OPTIONS = {
  tokensPerInterval: 1,
  interval: 2000,      // refill one token every 2 seconds
  maxRetries: 8,
  baseBackoff: 1000,   // 1 second base for exponential backoff
  maxBackoff: 300000,  // 5 minutes cap
  jitterFactor: 0.3,   // ±30 % random jitter on each backoff
};

class RateLimiter {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tokens = this.options.tokensPerInterval;
    this.lastRefill = Date.now();
    this.retryCount = 0;
    this.nextAllowedTime = 0;
  }

  /** Refill the token bucket based on elapsed time. */
  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / this.options.interval) * this.options.tokensPerInterval;
    this.tokens = Math.min(this.options.tokensPerInterval, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Returns milliseconds to wait before the next request is allowed.
   * Returns 0 if a request can proceed immediately.
   */
  getWaitTime() {
    const now = Date.now();
    if (now < this.nextAllowedTime) {
      return this.nextAllowedTime - now;
    }
    this._refill();
    if (this.tokens >= 1) {
      return 0;
    }
    return Math.ceil(((1 - this.tokens) / this.options.tokensPerInterval) * this.options.interval);
  }

  /**
   * Consume one token.
   * @returns {boolean} true if a token was available and consumed.
   */
  consume() {
    const now = Date.now();
    if (now < this.nextAllowedTime) {
      return false;
    }
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Handle an HTTP 429 (rate-limit) response with exponential backoff + jitter.
   * @param {number|null} retryAfterMs - Value from Retry-After header (ms), or null.
   * @returns {number} Milliseconds to wait before retrying.
   */
  handleRateLimitResponse(retryAfterMs = null) {
    if (this.retryCount >= this.options.maxRetries) {
      throw new Error(`Max retries (${this.options.maxRetries}) exceeded`);
    }

    let backoff;
    if (retryAfterMs != null) {
      backoff = retryAfterMs;
    } else {
      backoff = Math.min(
        this.options.baseBackoff * Math.pow(2, this.retryCount),
        this.options.maxBackoff
      );
    }

    // Add ±jitterFactor jitter to reduce thundering-herd effect.
    const jitter = (Math.random() * 2 - 1) * this.options.jitterFactor * backoff;
    backoff = Math.max(0, backoff + jitter);

    this.retryCount++;
    this.nextAllowedTime = Date.now() + backoff;
    return backoff;
  }

  /** Reset retry state after a successful request. */
  onSuccess() {
    this.retryCount = 0;
    this.nextAllowedTime = 0;
  }

  /**
   * Run an async function respecting the rate limit.
   * Automatically retries on HTTP 429 errors using exponential backoff.
   * @param {Function} fn - Async function to execute.
   * @returns {Promise<*>} Result of fn.
   */
  async schedule(fn) {
    const wait = this.getWaitTime();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    if (!this.consume()) {
      await new Promise((resolve) => setTimeout(resolve, this.options.interval));
      return this.schedule(fn);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (error.status === 429 || error.rateLimited) {
        const retryAfterMs = error.retryAfter ? error.retryAfter * 1000 : null;
        const waitMs = this.handleRateLimitResponse(retryAfterMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.schedule(fn);
      }
      throw error;
    }
  }
}

export { RateLimiter, DEFAULT_OPTIONS };
