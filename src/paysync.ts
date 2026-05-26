/**
 * paysync.ts — PaySync client, migrated from callbacks to async/await.
 *
 * The PaySync class exposes four Promise-returning methods over the
 * fictional payments processor, with callback overloads retained for
 * compatibility with older callers:
 *
 *   await paySync.charge(amount, opts)
 *   await paySync.refund(txnId, opts)
 *   await paySync.lookup(txnId, opts)
 *   await paySync.cancelTransaction(txnId, opts)
 *
 * History notes (see CHANGELOG):
 *   - v0.1 (2017-03)   shipped charge/refund/lookup with the callback
 *                      interface that's still in place today
 *   - v0.4 (2017-08)   added per-call cancellation tokens because
 *                      operators were complaining about hung pages
 *   - v0.7 (2018-01)   added internal retry on transport failures
 *                      (FB-201) so callers stopped seeing transient
 *                      network blips
 *   - v0.9 (2018-06)   added the variadic receipt + metadata returns to
 *                      charge/refund so dashboards could display the
 *                      full server response without a follow-up lookup
 *   - v1.0 (2018-11)   cancelTransaction shipped with the
 *                      EventEmitter-based completion notification —
 *                      the request callback fires on submission, but
 *                      "the cancellation actually completed" is signaled
 *                      asynchronously via the 'cancelled' event.
 *   - v1.2 (2019-03)   gateway started returning structured error
 *                      payloads with a `_raw` diagnostic blob. We
 *                      translate those into typed subclasses at the
 *                      response handler so callers can branch on
 *                      err instanceof RateLimitError / etc.
 *
 * Async options support `signal?: AbortSignal`, while the legacy
 * `opts.cancellationToken` remains supported for compatibility.
 */

import { EventEmitter } from 'node:events';
import * as httpClient from './httpClient';
import { _doRequest } from './retry';
import {
  RateLimitError,
  InsufficientFundsError,
  ValidationError,
  NetworkTimeoutError,
  CancellationError,
} from './errors';
import type { CancellationToken } from './cancellation';
import type { RawError } from './httpClient';

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

export interface ChargeOptions {
  currency?: string;
  customerId?: string;
  cancellationToken?: CancellationToken;
  signal?: AbortSignal;
}

export interface RefundOptions {
  reason?: string;
  cancellationToken?: CancellationToken;
  signal?: AbortSignal;
}

export interface LookupOptions {
  cancellationToken?: CancellationToken;
  signal?: AbortSignal;
}

export interface CancelTransactionOptions {
  cancellationToken?: CancellationToken;
  signal?: AbortSignal;
}

export interface Receipt {
  amountCents: number;
  currency: string;
  capturedAt: number;
}

export interface RequestMetadata {
  requestId: string;
  serverTimeMs: number;
}

export interface Transaction {
  txnId: string;
  amountCents: number;
  currency: string;
  status: 'authorized' | 'captured' | 'refunded' | 'cancelled';
  createdAt: number;
}

export interface ChargeResult {
  txnId: string;
  receipt: Receipt;
  metadata: RequestMetadata;
}

export interface RefundResult {
  refundId: string;
  receipt: Receipt;
  metadata: RequestMetadata;
}

export type ChargeCallback = (
  err: Error | null,
  txnId?: string,
  receipt?: Receipt,
  metadata?: RequestMetadata
) => void;

export type RefundCallback = (
  err: Error | null,
  refundId?: string,
  receipt?: Receipt,
  metadata?: RequestMetadata
) => void;

export type LookupCallback = (
  err: Error | null,
  txn?: Transaction
) => void;

export type CancelCallback = (err: Error | null) => void;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Translate a raw gateway error into the typed PaySync subclass. The
 * gateway tags structured failures with an `_raw` diagnostic; we map
 * that to the right error class. NetworkTimeoutError is constructed by
 * `_doRequest` directly when retries exhaust, so we pass it through.
 */
function translateRawError(err: RawError | null): Error | null {
  if (!err) return null;
  if (err instanceof RateLimitError) return err;
  if (err instanceof InsufficientFundsError) return err;
  if (err instanceof NetworkTimeoutError) return err;
  if (err instanceof CancellationError) return err;

  const raw = err._raw;
  if (raw?.code === 429) {
    return new RateLimitError({ retryAfterMs: raw.retryAfter ?? 1000 });
  }
  if (raw?.code === 402) {
    return new InsufficientFundsError({ availableBalance: raw.balance ?? 0 });
  }
  return err;
}

interface CancellationBridge {
  signal?: AbortSignal;
  cleanup(): void;
}

function createCancellationBridge(
  cancellationToken?: CancellationToken,
  signal?: AbortSignal
): CancellationBridge {
  if (!cancellationToken) {
    return {
      signal,
      cleanup(): void {
        // The request helper owns any listener it attaches to this signal.
      },
    };
  }

  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const onExternalAbort = (): void => abort();

  signal?.addEventListener('abort', onExternalAbort, { once: true });
  cancellationToken.onCancel(abort);
  if (cancellationToken.isCancelled() || signal?.aborted) {
    abort();
  }

  return {
    signal: controller.signal,
    cleanup(): void {
      signal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

function isCancelledPayload(payload: unknown, txnId: string): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { txnId?: unknown }).txnId === txnId
  );
}

// ---------------------------------------------------------------------------
// PaySync class
// ---------------------------------------------------------------------------

export class PaySync extends EventEmitter {
  charge(amount: number, opts?: ChargeOptions): Promise<ChargeResult>;
  charge(amount: number, opts: ChargeOptions, cb: ChargeCallback): void;
  charge(
    amount: number,
    opts: ChargeOptions = {},
    cb?: ChargeCallback
  ): Promise<ChargeResult> | void {
    if (cb) {
      this.forwardChargeCallback(this.chargePromise(amount, opts), cb);
      return;
    }

    try {
      return this.chargePromise(amount, opts);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  refund(txnId: string, opts?: RefundOptions): Promise<RefundResult>;
  refund(txnId: string, opts: RefundOptions, cb: RefundCallback): void;
  refund(
    txnId: string,
    opts: RefundOptions = {},
    cb?: RefundCallback
  ): Promise<RefundResult> | void {
    if (cb) {
      this.forwardRefundCallback(this.refundPromise(txnId, opts), cb);
      return;
    }

    try {
      return this.refundPromise(txnId, opts);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  lookup(txnId: string): Promise<Transaction>;
  lookup(txnId: string, opts: LookupOptions): Promise<Transaction>;
  lookup(txnId: string, cb: LookupCallback): void;
  lookup(txnId: string, opts: LookupOptions, cb: LookupCallback): void;
  lookup(
    txnId: string,
    optsOrCb: LookupOptions | LookupCallback = {},
    cb?: LookupCallback
  ): Promise<Transaction> | void {
    const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;

    if (callback) {
      this.forwardLookupCallback(this.lookupPromise(txnId, opts), callback);
      return;
    }

    try {
      return this.lookupPromise(txnId, opts);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  cancelTransaction(txnId: string): Promise<void>;
  cancelTransaction(
    txnId: string,
    opts: CancelTransactionOptions
  ): Promise<void>;
  cancelTransaction(txnId: string, cb: CancelCallback): void;
  cancelTransaction(
    txnId: string,
    opts: CancelTransactionOptions,
    cb: CancelCallback
  ): void;
  cancelTransaction(
    txnId: string,
    optsOrCb: CancelTransactionOptions | CancelCallback = {},
    cb?: CancelCallback
  ): Promise<void> | void {
    const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;

    if (callback) {
      this.forwardCancelCallback(
        this.cancelTransactionPromise(txnId, opts),
        callback
      );
      return;
    }

    try {
      return this.cancelTransactionPromise(txnId, opts);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private forwardChargeCallback(
    promise: Promise<ChargeResult>,
    cb: ChargeCallback
  ): void {
    promise.then(
      ({ txnId, receipt, metadata }) => cb(null, txnId, receipt, metadata),
      (err: Error) => cb(err)
    );
  }

  private forwardRefundCallback(
    promise: Promise<RefundResult>,
    cb: RefundCallback
  ): void {
    promise.then(
      ({ refundId, receipt, metadata }) => cb(null, refundId, receipt, metadata),
      (err: Error) => cb(err)
    );
  }

  private forwardLookupCallback(
    promise: Promise<Transaction>,
    cb: LookupCallback
  ): void {
    promise.then((txn) => cb(null, txn), (err: Error) => cb(err));
  }

  private forwardCancelCallback(
    promise: Promise<void>,
    cb: CancelCallback
  ): void {
    promise.then(() => cb(null), (err: Error) => cb(err));
  }

  private chargePromise(
    amount: number,
    opts: ChargeOptions = {}
  ): Promise<ChargeResult> {
    // Synchronous validation — predates the callback-error pattern.
    const fieldErrors: Record<string, string> = {};
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      fieldErrors.amount = 'must be a finite number';
    } else if (amount <= 0) {
      fieldErrors.amount = 'must be positive';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const body = {
      amount,
      currency: opts.currency ?? 'USD',
      customerId: opts.customerId,
    };
    const bridge = createCancellationBridge(opts.cancellationToken, opts.signal);

    return new Promise<ChargeResult>((resolve, reject) => {
      let settled = false;

      const settle = (err: Error | null, result?: ChargeResult): void => {
        if (settled) return;
        settled = true;
        bridge.cleanup();
        if (err) {
          reject(err);
          return;
        }
        resolve(result as ChargeResult);
      };

      _doRequest('/v1/charges', body, (err, ...rest) => {
        if (settled) return;
        if (err) {
          settle(translateRawError(err));
          return;
        }
        // Gateway delivers (txnId, receipt, metadata) as positional args.
        const [txnId, receipt, metadata] = rest as [
          string,
          Receipt,
          RequestMetadata
        ];
        settle(null, { txnId, receipt, metadata });
      }, bridge.signal);
    });
  }

  private refundPromise(
    txnId: string,
    opts: RefundOptions = {}
  ): Promise<RefundResult> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const body = { txnId, reason: opts.reason };
    const bridge = createCancellationBridge(opts.cancellationToken, opts.signal);

    return new Promise<RefundResult>((resolve, reject) => {
      let settled = false;

      const settle = (err: Error | null, result?: RefundResult): void => {
        if (settled) return;
        settled = true;
        bridge.cleanup();
        if (err) {
          reject(err);
          return;
        }
        resolve(result as RefundResult);
      };

      _doRequest('/v1/refunds', body, (err, ...rest) => {
        if (settled) return;
        if (err) {
          settle(translateRawError(err));
          return;
        }
        const [refundId, receipt, metadata] = rest as [
          string,
          Receipt,
          RequestMetadata
        ];
        settle(null, { refundId, receipt, metadata });
      }, bridge.signal);
    });
  }

  private lookupPromise(
    txnId: string,
    opts: LookupOptions = {}
  ): Promise<Transaction> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const bridge = createCancellationBridge(opts.cancellationToken, opts.signal);

    return new Promise<Transaction>((resolve, reject) => {
      let settled = false;

      const settle = (err: Error | null, txn?: Transaction): void => {
        if (settled) return;
        settled = true;
        bridge.cleanup();
        if (err) {
          reject(err);
          return;
        }
        resolve(txn as Transaction);
      };

      _doRequest('/v1/lookup', { txnId }, (err, ...rest) => {
        if (settled) return;
        if (err) {
          settle(translateRawError(err));
          return;
        }
        const [txn] = rest as [Transaction];
        settle(null, txn);
      }, bridge.signal);
    });
  }

  /**
   * cancelTransaction submits a cancellation order, then waits for
   * server-side completion via the `'cancelled'` event on this PaySync
   * instance with payload `{ txnId: string }`.
   */
  private cancelTransactionPromise(
    txnId: string,
    opts: CancelTransactionOptions = {}
  ): Promise<void> {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const bridge = createCancellationBridge(opts.cancellationToken, opts.signal);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let submissionSettled = false;
      let submissionAccepted = false;
      let completionReceived = false;

      const cleanup = (): void => {
        this.off('cancelled', onCancelled);
        bridge.signal?.removeEventListener('abort', onAbort);
        bridge.cleanup();
      };

      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      const maybeResolve = (): void => {
        if (submissionAccepted && completionReceived) {
          settle();
        }
      };

      const onCancelled = (payload: unknown): void => {
        if (!isCancelledPayload(payload, txnId)) {
          return;
        }
        completionReceived = true;
        maybeResolve();
      };

      const onAbort = (): void => settle(new CancellationError());

      if (bridge.signal?.aborted) {
        settle(new CancellationError());
        return;
      }
      bridge.signal?.addEventListener('abort', onAbort, { once: true });
      this.on('cancelled', onCancelled);

      httpClient.post('/v1/cancellations', { txnId }, (err) => {
        if (settled || submissionSettled) return;
        submissionSettled = true;
        if (err) {
          settle(translateRawError(err) ?? err);
          return;
        }
        submissionAccepted = true;
        maybeResolve();
      });
    });
  }
}
