/**
 * paysync.ts — PaySync client (callback-style, 2017-era).
 *
 * The PaySync class exposes four callback-style methods over the
 * fictional payments processor:
 *
 *   paySync.charge(amount, opts, cb)
 *   paySync.refund(txnId, opts, cb)
 *   paySync.lookup(txnId, cb)
 *   paySync.cancelTransaction(txnId, cb)
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
 * All four methods accept either an explicit callback or
 * `opts.cancellationToken` (legacy token interface).
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
}

export interface RefundOptions {
  reason?: string;
  cancellationToken?: CancellationToken;
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

// ---------------------------------------------------------------------------
// PaySync class
// ---------------------------------------------------------------------------

export class PaySync extends EventEmitter {
  charge(amount: number, opts: ChargeOptions, cb: ChargeCallback): void {
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

    const token = opts.cancellationToken;
    let settled = false;

    const settle: ChargeCallback = (err, txnId, receipt, metadata) => {
      if (settled) return;
      settled = true;
      cb(err, txnId, receipt, metadata);
    };

    if (token?.isCancelled()) {
      settle(new CancellationError());
      return;
    }
    token?.onCancel(() => settle(new CancellationError()));

    const body = {
      amount,
      currency: opts.currency ?? 'USD',
      customerId: opts.customerId,
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
      settle(null, txnId, receipt, metadata);
    });
  }

  refund(txnId: string, opts: RefundOptions, cb: RefundCallback): void {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    const token = opts.cancellationToken;
    let settled = false;

    const settle: RefundCallback = (err, refundId, receipt, metadata) => {
      if (settled) return;
      settled = true;
      cb(err, refundId, receipt, metadata);
    };

    if (token?.isCancelled()) {
      settle(new CancellationError());
      return;
    }
    token?.onCancel(() => settle(new CancellationError()));

    const body = { txnId, reason: opts.reason };

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
      settle(null, refundId, receipt, metadata);
    });
  }

  lookup(txnId: string, cb: LookupCallback): void {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    _doRequest('/v1/lookup', { txnId }, (err, ...rest) => {
      if (err) {
        cb(translateRawError(err));
        return;
      }
      const [txn] = rest as [Transaction];
      cb(null, txn);
    });
  }

  /**
   * cancelTransaction — submits a cancellation order. The callback fires
   * on submission. Server-side completion is signaled via the
   * `'cancelled'` event on this PaySync instance with payload
   * `{ txnId: string }`.
   */
  cancelTransaction(txnId: string, cb: CancelCallback): void {
    const fieldErrors: Record<string, string> = {};
    if (typeof txnId !== 'string' || txnId.length === 0) {
      fieldErrors.txnId = 'must be a non-empty string';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError({ fieldErrors });
    }

    httpClient.post('/v1/cancellations', { txnId }, (err) => {
      if (err) {
        cb(translateRawError(err));
        return;
      }
      cb(null);
    });
  }
}
