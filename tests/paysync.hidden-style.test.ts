import * as publicApi from '../src';
import * as httpClient from '../src/httpClient';
import { CancellationError, RateLimitError, ValidationError } from '../src/errors';
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
    expect(publicApi.ValidationError).toBe(ValidationError);
    expect(typeof publicApi.createCancellationToken).toBe('function');
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
