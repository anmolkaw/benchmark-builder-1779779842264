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
