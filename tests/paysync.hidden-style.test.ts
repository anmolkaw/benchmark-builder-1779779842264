import * as publicApi from '../src';
import * as httpClient from '../src/httpClient';
import type {
  CancellationToken,
  CancelTransactionOptions,
  ChargeOptions,
  ChargeResult,
  LookupOptions,
  Receipt,
  RefundOptions,
  RefundResult,
  RequestMetadata,
  Transaction,
} from '../src';
import {
  CancellationError,
  InsufficientFundsError,
  NetworkTimeoutError,
  RateLimitError,
  ValidationError,
} from '../src/errors';
import { PaySync } from '../src/paysync';

describe('PaySync hidden-style async migration cases', () => {
  let post: jest.SpyInstance;

  beforeEach(() => {
    post = jest.spyOn(httpClient, 'post');
  });

  afterEach(() => {
    post.mockRestore();
    jest.useRealTimers();
  });

  test('catches migration that rewrites the named export surface', () => {
    expect(publicApi.PaySync).toBe(PaySync);
    expect(publicApi.RateLimitError).toBe(RateLimitError);
    expect(publicApi.InsufficientFundsError).toBe(InsufficientFundsError);
    expect(publicApi.NetworkTimeoutError).toBe(NetworkTimeoutError);
    expect(publicApi.CancellationError).toBe(CancellationError);
    expect(publicApi.ValidationError).toBe(ValidationError);
    expect(typeof publicApi.createCancellationToken).toBe('function');
  });

  test('catches removal of exported option and result types at compile time', () => {
    const token: CancellationToken = publicApi.createCancellationToken();
    const chargeOptions: ChargeOptions = {
      currency: 'USD',
      customerId: 'cus_type',
      cancellationToken: token,
    };
    const refundOptions: RefundOptions = { reason: 'requested_by_customer' };
    const lookupOptions: LookupOptions = {};
    const cancelOptions: CancelTransactionOptions = {};
    const receipt: Receipt = {
      amountCents: 100,
      currency: 'USD',
      capturedAt: 1,
    };
    const metadata: RequestMetadata = {
      requestId: 'req_type',
      serverTimeMs: 1,
    };
    const chargeResult: ChargeResult = {
      txnId: 'txn_type',
      receipt,
      metadata,
    };
    const refundResult: RefundResult = {
      refundId: 'rf_type',
      receipt,
      metadata,
    };
    const transaction: Transaction = {
      txnId: 'txn_type',
      amountCents: 100,
      currency: 'USD',
      status: 'captured',
      createdAt: 1,
    };

    expect(chargeOptions.currency).toBe('USD');
    expect(refundOptions.reason).toBe('requested_by_customer');
    expect(lookupOptions).toEqual({});
    expect(cancelOptions).toEqual({});
    expect(chargeResult.receipt).toBe(receipt);
    expect(refundResult.metadata).toBe(metadata);
    expect(transaction.status).toBe('captured');
  });

  test('catches methods that stop returning Promises for async-style calls', () => {
    post.mockImplementation((url, _body, cb) => {
      if (url === '/v1/lookup') {
        cb(null, {
          txnId: 'txn_promise',
          amountCents: 100,
          currency: 'USD',
          status: 'captured',
          createdAt: 1,
        });
        return;
      }
      cb(
        null,
        url === '/v1/refunds' ? 'rf_promise' : 'txn_promise',
        { amountCents: 100, currency: 'USD', capturedAt: 1 },
        { requestId: 'req_promise', serverTimeMs: 1 }
      );
    });

    const paySync = new PaySync();
    const chargePromise = paySync.charge(100, {});
    const refundPromise = paySync.refund('txn_promise', {});
    const lookupPromise = paySync.lookup('txn_promise');
    const cancelPromise = paySync.cancelTransaction('txn_promise');
    paySync.emit('cancelled', { txnId: 'txn_promise' });

    expect(chargePromise).toBeInstanceOf(Promise);
    expect(refundPromise).toBeInstanceOf(Promise);
    expect(lookupPromise).toBeInstanceOf(Promise);
    expect(cancelPromise).toBeInstanceOf(Promise);
  });

  test('catches compatibility break that removes callback-style charge', async () => {
    const receipt = { amountCents: 500, currency: 'USD', capturedAt: 11 };
    const metadata = { requestId: 'req_charge_cb', serverTimeMs: 3 };
    const lateReceipt = { amountCents: 999, currency: 'USD', capturedAt: 12 };
    const lateMetadata = { requestId: 'req_charge_late', serverTimeMs: 4 };
    const callback = jest.fn();

    post.mockImplementation((_url, _body, cb) => {
      cb(null, 'txn_charge_cb', receipt, metadata);
      cb(null, 'txn_charge_late', lateReceipt, lateMetadata);
    });

    new PaySync().charge(500, {}, callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      null,
      'txn_charge_cb',
      receipt,
      metadata
    );
  });

  test('catches compatibility break that removes callback-style refund', async () => {
    const receipt = { amountCents: 500, currency: 'USD', capturedAt: 22 };
    const metadata = { requestId: 'req_refund_cb', serverTimeMs: 5 };

    post.mockImplementation((url, body, cb) => {
      expect(url).toBe('/v1/refunds');
      expect(body).toEqual({ txnId: 'txn_refund_cb', reason: 'duplicate' });
      cb(null, 'rf_refund_cb', receipt, metadata);
    });

    await new Promise<void>((resolve, reject) => {
      new PaySync().refund(
        'txn_refund_cb',
        { reason: 'duplicate' },
        (err, refundId, callbackReceipt, callbackMetadata) => {
          try {
            expect(err).toBeNull();
            expect(refundId).toBe('rf_refund_cb');
            expect(callbackReceipt).toBe(receipt);
            expect(callbackMetadata).toBe(metadata);
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        }
      );
    });
  });

  test('catches compatibility break that removes callback-style lookup', async () => {
    const txn = {
      txnId: 'txn_lookup_cb',
      amountCents: 750,
      currency: 'USD',
      status: 'captured' as const,
      createdAt: 33,
    };

    post.mockImplementation((_url, _body, cb) => cb(null, txn));

    await new Promise<void>((resolve, reject) => {
      new PaySync().lookup('txn_lookup_cb', (err, callbackTxn) => {
        try {
          expect(err).toBeNull();
          expect(callbackTxn).toBe(txn);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  });

  test('catches compatibility break that removes callback-style cancelTransaction', async () => {
    const paySync = new PaySync();
    const callback = jest.fn();

    post.mockImplementation((url, body, cb) => {
      expect(url).toBe('/v1/cancellations');
      expect(body).toEqual({ txnId: 'txn_cancel_cb' });
      cb(null);
    });

    paySync.cancelTransaction('txn_cancel_cb', callback);
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();

    paySync.emit('cancelled', { txnId: 'txn_other' });
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();

    paySync.emit('cancelled', { txnId: 'txn_cancel_cb' });
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null);
    expect(paySync.listenerCount('cancelled')).toBe(0);
  });

  test('catches migration that drops legacy CancellationToken support', async () => {
    const token = publicApi.createCancellationToken();
    const callback = jest.fn();
    let finishRequest:
      | ((err: Error | null, ...rest: unknown[]) => void)
      | undefined;

    post.mockImplementation((_url, _body, cb) => {
      finishRequest = cb;
    });

    new PaySync().charge(100, { cancellationToken: token }, callback);
    token.cancel();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(CancellationError);

    finishRequest?.(
      null,
      'txn_after_cancel',
      { amountCents: 100, currency: 'USD', capturedAt: 1 },
      { requestId: 'req_after_cancel', serverTimeMs: 1 }
    );
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('catches cancellation token cancelled before call in promise and callback styles', async () => {
    const promiseToken = publicApi.createCancellationToken();
    promiseToken.cancel();
    await expect(
      new PaySync().charge(100, { cancellationToken: promiseToken })
    ).rejects.toBeInstanceOf(CancellationError);
    expect(post).not.toHaveBeenCalled();

    const callbackToken = publicApi.createCancellationToken();
    const callback = jest.fn();
    callbackToken.cancel();
    new PaySync().lookup('txn_pre_cancelled', {
      cancellationToken: callbackToken,
    }, callback);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(CancellationError);
    expect(post).not.toHaveBeenCalled();
  });

  test('catches token listener path that fires again after successful completion', async () => {
    const token = publicApi.createCancellationToken();
    const callback = jest.fn();
    post.mockImplementation((_url, _body, cb) => {
      cb(
        null,
        'txn_token_success',
        { amountCents: 100, currency: 'USD', capturedAt: 1 },
        { requestId: 'req_token_success', serverTimeMs: 1 }
      );
    });

    new PaySync().charge(100, { cancellationToken: token }, callback);
    await Promise.resolve();
    token.cancel();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeNull();
  });

  test('catches naive response mapping that drops receipt and metadata', async () => {
    const receipt = { amountCents: 2500, currency: 'EUR', capturedAt: 123 };
    const metadata = { requestId: 'req_mapping', serverTimeMs: 12 };

    post.mockImplementation((url, body, cb) => {
      expect(url).toBe('/v1/charges');
      expect(body).toEqual({
        amount: 2500,
        currency: 'EUR',
        customerId: 'cus_123',
      });
      cb(null, 'txn_mapping', receipt, metadata);
    });

    await expect(
      new PaySync().charge(2500, { currency: 'EUR', customerId: 'cus_123' })
    ).resolves.toEqual({ txnId: 'txn_mapping', receipt, metadata });
  });

  test('catches migration that rejects missing optional currency or customerId', async () => {
    const receipt = { amountCents: 2500, currency: 'USD', capturedAt: 123 };
    const metadata = { requestId: 'req_defaults', serverTimeMs: 12 };

    post.mockImplementation((_url, body, cb) => {
      expect(body).toEqual({
        amount: 2500,
        currency: 'USD',
        customerId: undefined,
      });
      cb(null, 'txn_defaults', receipt, metadata);
    });

    await expect(new PaySync().charge(2500, {})).resolves.toEqual({
      txnId: 'txn_defaults',
      receipt,
      metadata,
    });
  });

  test('catches validation migration that loses field-level details', async () => {
    await expect(new PaySync().charge(0, {})).rejects.toMatchObject({
      name: 'ValidationError',
      fieldErrors: { amount: 'must be positive' },
    });
    await expect(new PaySync().charge(Number.NaN, {})).rejects.toMatchObject({
      fieldErrors: { amount: 'must be a finite number' },
    });
    await expect(new PaySync().refund('', {})).rejects.toMatchObject({
      fieldErrors: { txnId: 'must be a non-empty string' },
    });
    await expect(new PaySync().lookup('')).rejects.toBeInstanceOf(ValidationError);
    await expect(new PaySync().cancelTransaction('')).rejects.toMatchObject({
      fieldErrors: { txnId: 'must be a non-empty string' },
    });
  });

  test('catches generic Error conversion that loses gateway diagnostics', async () => {
    const rawRateLimit = Object.assign(new Error('gateway limited request'), {
      _raw: { code: 429, retryAfter: 2500 },
    });
    post.mockImplementation((_url, _body, cb) => cb(rawRateLimit));

    await expect(new PaySync().lookup('txn_rate_limited')).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfterMs: 2500,
    });
    await expect(new PaySync().lookup('txn_rate_limited')).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  test('catches custom error preservation for insufficient funds and unknown gateway errors', async () => {
    const insufficientFunds = Object.assign(new Error('gateway declined'), {
      _raw: { code: 402, balance: 1234 },
    });
    post.mockImplementationOnce((_url, _body, cb) => cb(insufficientFunds));

    await expect(new PaySync().charge(5000, {})).rejects.toMatchObject({
      name: 'InsufficientFundsError',
      availableBalance: 1234,
    });

    const unknown = new Error('opaque gateway failure');
    post.mockImplementationOnce((_url, _body, cb) => cb(unknown));
    await expect(new PaySync().lookup('txn_unknown')).rejects.toBe(unknown);
  });

  test('catches non-transient business errors being retried', async () => {
    const insufficientFunds = Object.assign(new Error('gateway declined'), {
      _raw: { code: 402, balance: 42 },
    });
    post.mockImplementation((_url, _body, cb) => cb(insufficientFunds));

    await expect(new PaySync().charge(5000, {})).rejects.toBeInstanceOf(
      InsufficientFundsError
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('catches migration that ignores AbortSignal during retry backoff', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const transient = Object.assign(new Error('temporary network failure'), {
      _raw: { transient: true },
    });
    post.mockImplementation((_url, _body, cb) => cb(transient));

    const promise = new PaySync().charge(100, { signal: controller.signal });
    expect(post).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CancellationError);

    jest.advanceTimersByTime(1000);
    expect(post).toHaveBeenCalledTimes(1);
  });

  test('catches pre-aborted AbortSignal that still starts network work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new PaySync().charge(100, { signal: controller.signal })
    ).rejects.toBeInstanceOf(CancellationError);
    expect(post).not.toHaveBeenCalled();
  });

  test('catches AbortSignal listener leaks after in-flight abort', async () => {
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    post.mockImplementation((_url, _body, _cb) => {
      // Leave the request in flight until abort.
    });

    const promise = new PaySync().lookup('txn_abort_in_flight', {
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(CancellationError);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  test('catches AbortSignal listener leaks after success', async () => {
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    post.mockImplementation((_url, _body, cb) => {
      cb(null, {
        txnId: 'txn_success_cleanup',
        amountCents: 100,
        currency: 'USD',
        status: 'captured',
        createdAt: 1,
      });
    });

    await expect(
      new PaySync().lookup('txn_success_cleanup', { signal: controller.signal })
    ).resolves.toMatchObject({ txnId: 'txn_success_cleanup' });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  test('catches retry policy drift for transient errors before success', async () => {
    jest.useFakeTimers();
    const transient = Object.assign(new Error('temporary network failure'), {
      _raw: { transient: true },
    });
    const receipt = { amountCents: 100, currency: 'USD', capturedAt: 1 };
    const metadata = { requestId: 'req_retry_success', serverTimeMs: 1 };

    post
      .mockImplementationOnce((_url, _body, cb) => cb(transient))
      .mockImplementationOnce((_url, _body, cb) => cb(transient))
      .mockImplementationOnce((_url, _body, cb) => {
        cb(null, 'txn_retry_success', receipt, metadata);
      });

    const promise = new PaySync().charge(100, {});
    expect(post).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(post).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(200);
    await expect(promise).resolves.toEqual({
      txnId: 'txn_retry_success',
      receipt,
      metadata,
    });
    expect(post).toHaveBeenCalledTimes(3);
  });

  test('catches retry exhaustion that loses NetworkTimeoutError attempts', async () => {
    jest.useFakeTimers();
    const transient = Object.assign(new Error('temporary network failure'), {
      _raw: { transient: true },
    });
    post.mockImplementation((_url, _body, cb) => cb(transient));

    const promise = new PaySync().lookup('txn_retry_exhausted');
    jest.advanceTimersByTime(100);
    jest.advanceTimersByTime(200);

    await expect(promise).rejects.toMatchObject({
      name: 'NetworkTimeoutError',
      attempts: 3,
    });
    expect(post).toHaveBeenCalledTimes(3);
  });

  test('catches naive Promise wrapper that lets duplicate callbacks change the result', async () => {
    const firstReceipt = { amountCents: 100, currency: 'USD', capturedAt: 1 };
    const firstMetadata = { requestId: 'req_first', serverTimeMs: 1 };
    const secondReceipt = { amountCents: 999, currency: 'USD', capturedAt: 2 };
    const secondMetadata = { requestId: 'req_second', serverTimeMs: 2 };

    post.mockImplementation((_url, _body, cb) => {
      cb(null, 'txn_first', firstReceipt, firstMetadata);
      cb(null, 'txn_second', secondReceipt, secondMetadata);
    });

    await expect(new PaySync().charge(100, {})).resolves.toEqual({
      txnId: 'txn_first',
      receipt: firstReceipt,
      metadata: firstMetadata,
    });
  });

  test('catches duplicate provider callback that tries to turn a rejection into success', async () => {
    const rawRateLimit = Object.assign(new Error('gateway limited request'), {
      _raw: { code: 429, retryAfter: 100 },
    });
    post.mockImplementation((_url, _body, cb) => {
      cb(rawRateLimit);
      cb(null, {
        txnId: 'txn_late_success',
        amountCents: 100,
        currency: 'USD',
        status: 'captured',
        createdAt: 1,
      });
    });

    await expect(new PaySync().lookup('txn_duplicate_error')).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  test('catches simplified cancelTransaction that resolves before matching cancelled event', async () => {
    let submitCancellation: ((err: Error | null) => void) | undefined;
    post.mockImplementation((_url, _body, cb) => {
      submitCancellation = cb;
    });

    const paySync = new PaySync();
    const promise = paySync.cancelTransaction('txn_cancel');
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    paySync.emit('cancelled', { txnId: 'txn_cancel' });
    await Promise.resolve();
    expect(resolved).toBe(false);

    submitCancellation?.(null);
    await expect(promise).resolves.toBeUndefined();
    expect(paySync.listenerCount('cancelled')).toBe(0);
  });

  test('catches cancelTransaction provider failure being swallowed or leaking listeners', async () => {
    const paySync = new PaySync();
    const providerFailure = Object.assign(new Error('cancel declined'), {
      _raw: { code: 402, balance: 0 },
    });
    post.mockImplementation((_url, _body, cb) => cb(providerFailure));

    await expect(paySync.cancelTransaction('txn_cancel_fail')).rejects.toBeInstanceOf(
      InsufficientFundsError
    );
    expect(paySync.listenerCount('cancelled')).toBe(0);
  });

  test('catches cancelTransaction that leaks listeners after abort', async () => {
    const controller = new AbortController();
    post.mockImplementation((_url, _body, cb) => cb(null));

    const paySync = new PaySync();
    const promise = paySync.cancelTransaction('txn_abort', {
      signal: controller.signal,
    });
    expect(paySync.listenerCount('cancelled')).toBe(1);

    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CancellationError);
    expect(paySync.listenerCount('cancelled')).toBe(0);
  });
});
