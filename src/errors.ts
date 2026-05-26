/**
 * PaySync error subclasses.
 *
 * These classes were added incrementally as the API surface grew. Each
 * carries a small payload describing the failure so callers can branch
 * on the failure mode without parsing message strings.
 */

export class RateLimitError extends Error {
  public readonly retryAfterMs: number;

  constructor(opts: { retryAfterMs: number; message?: string }) {
    super(opts.message ?? 'Rate limit exceeded');
    this.name = 'RateLimitError';
    this.retryAfterMs = opts.retryAfterMs;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class InsufficientFundsError extends Error {
  public readonly availableBalance: number;

  constructor(opts: { availableBalance: number; message?: string }) {
    super(opts.message ?? 'Insufficient funds');
    this.name = 'InsufficientFundsError';
    this.availableBalance = opts.availableBalance;
    Object.setPrototypeOf(this, InsufficientFundsError.prototype);
  }
}

export class ValidationError extends Error {
  public readonly fieldErrors: Record<string, string>;

  constructor(opts: { fieldErrors: Record<string, string>; message?: string }) {
    super(opts.message ?? 'Validation failed');
    this.name = 'ValidationError';
    this.fieldErrors = opts.fieldErrors;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NetworkTimeoutError extends Error {
  public readonly attempts: number;

  constructor(opts: { attempts: number; message?: string }) {
    super(opts.message ?? 'Network timeout');
    this.name = 'NetworkTimeoutError';
    this.attempts = opts.attempts;
    Object.setPrototypeOf(this, NetworkTimeoutError.prototype);
  }
}

export class CancellationError extends Error {
  public readonly cancelledAt: number;

  constructor(opts?: { cancelledAt?: number; message?: string }) {
    super(opts?.message ?? 'Request cancelled');
    this.name = 'CancellationError';
    this.cancelledAt = opts?.cancelledAt ?? Date.now();
    Object.setPrototypeOf(this, CancellationError.prototype);
  }
}
