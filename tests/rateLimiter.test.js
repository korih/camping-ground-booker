import { jest } from '@jest/globals';
import { RateLimiter, DEFAULT_OPTIONS } from '../src/utils/rateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('initialises with default options', () => {
      const rl = new RateLimiter();
      expect(rl.options.interval).toBe(DEFAULT_OPTIONS.interval);
      expect(rl.options.maxRetries).toBe(DEFAULT_OPTIONS.maxRetries);
      expect(rl.tokens).toBe(1);
      expect(rl.retryCount).toBe(0);
      expect(rl.nextAllowedTime).toBe(0);
    });

    it('merges custom options with defaults', () => {
      const rl = new RateLimiter({ interval: 1000, maxRetries: 3 });
      expect(rl.options.interval).toBe(1000);
      expect(rl.options.maxRetries).toBe(3);
      expect(rl.options.baseBackoff).toBe(DEFAULT_OPTIONS.baseBackoff);
    });
  });

  // ── consume ────────────────────────────────────────────────────────────────

  describe('consume', () => {
    it('returns true when a token is available', () => {
      expect(new RateLimiter().consume()).toBe(true);
    });

    it('returns false after the initial token is used up', () => {
      const rl = new RateLimiter();
      rl.consume();
      expect(rl.consume()).toBe(false);
    });

    it('refills a token after the configured interval', () => {
      const rl = new RateLimiter({ interval: 1000 });
      rl.consume();
      jest.advanceTimersByTime(1000);
      expect(rl.consume()).toBe(true);
    });

    it('returns false during a backoff window', () => {
      const rl = new RateLimiter();
      rl.nextAllowedTime = Date.now() + 10_000;
      expect(rl.consume()).toBe(false);
    });
  });

  // ── getWaitTime ────────────────────────────────────────────────────────────

  describe('getWaitTime', () => {
    it('returns 0 when a token is available', () => {
      expect(new RateLimiter().getWaitTime()).toBe(0);
    });

    it('returns a positive number when the bucket is empty', () => {
      const rl = new RateLimiter({ interval: 2000 });
      rl.consume();
      const wait = rl.getWaitTime();
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(2000);
    });

    it('returns remaining backoff time when in a backoff window', () => {
      const rl = new RateLimiter();
      rl.nextAllowedTime = Date.now() + 5000;
      const wait = rl.getWaitTime();
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(5000);
    });
  });

  // ── handleRateLimitResponse ───────────────────────────────────────────────

  describe('handleRateLimitResponse', () => {
    it('increments retryCount on each call', () => {
      const rl = new RateLimiter();
      rl.handleRateLimitResponse();
      expect(rl.retryCount).toBe(1);
      rl.handleRateLimitResponse();
      expect(rl.retryCount).toBe(2);
    });

    it('applies exponential backoff without jitter', () => {
      const rl = new RateLimiter({ baseBackoff: 1000, jitterFactor: 0 });
      expect(rl.handleRateLimitResponse()).toBeCloseTo(1000, -2);
      expect(rl.handleRateLimitResponse()).toBeCloseTo(2000, -2);
      expect(rl.handleRateLimitResponse()).toBeCloseTo(4000, -2);
    });

    it('honours an explicit Retry-After value', () => {
      const rl = new RateLimiter({ jitterFactor: 0 });
      expect(rl.handleRateLimitResponse(30_000)).toBeCloseTo(30_000, -2);
    });

    it('caps backoff at maxBackoff', () => {
      const rl = new RateLimiter({ baseBackoff: 1000, maxBackoff: 5000, jitterFactor: 0, maxRetries: 20 });
      rl.retryCount = 10;
      expect(rl.handleRateLimitResponse()).toBeLessThanOrEqual(5000);
    });

    it('throws when maxRetries is exceeded', () => {
      const rl = new RateLimiter({ maxRetries: 2 });
      rl.handleRateLimitResponse();
      rl.handleRateLimitResponse();
      expect(() => rl.handleRateLimitResponse()).toThrow('Max retries (2) exceeded');
    });

    it('sets nextAllowedTime to a future timestamp', () => {
      const rl = new RateLimiter({ jitterFactor: 0 });
      const before = Date.now();
      rl.handleRateLimitResponse();
      expect(rl.nextAllowedTime).toBeGreaterThan(before);
    });
  });

  // ── onSuccess ─────────────────────────────────────────────────────────────

  describe('onSuccess', () => {
    it('resets retryCount to 0', () => {
      const rl = new RateLimiter();
      rl.retryCount = 5;
      rl.onSuccess();
      expect(rl.retryCount).toBe(0);
    });

    it('clears the backoff window', () => {
      const rl = new RateLimiter();
      rl.nextAllowedTime = Date.now() + 60_000;
      rl.onSuccess();
      expect(rl.nextAllowedTime).toBe(0);
    });
  });

  // ── schedule ─────────────────────────────────────────────────────────────

  describe('schedule', () => {
    it('executes the function when a token is available', async () => {
      const rl = new RateLimiter();
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await rl.schedule(fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('propagates non-rate-limit errors without retrying', async () => {
      const rl = new RateLimiter();
      const fn = jest.fn().mockRejectedValue(new Error('Server error'));
      await expect(rl.schedule(fn)).rejects.toThrow('Server error');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
