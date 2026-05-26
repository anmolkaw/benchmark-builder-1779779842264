import * as httpClient from '../src/httpClient';
import { PaySync } from '../src/paysync';

describe('PaySync (public, async-style)', () => {
  let post: jest.SpyInstance;

  beforeEach(() => {
    post = jest.spyOn(httpClient, 'post');
  });

  afterEach(() => {
    post.mockRestore();
    jest.useRealTimers();
  });

  test('P1: charge is awaitable and resolves to a truthy value', async () => {
    post.mockImplementation((_url, _body, cb) => {
      cb(
        null,
        'txn_p1',
        { amountCents: 10000, currency: 'USD', capturedAt: 1 },
        { requestId: 'req_p1', serverTimeMs: 1 }
      );
    });

    const paySync = new PaySync();
    const result = await paySync.charge(100, {});
    expect(result).toBeTruthy();
  });

  test('P2: refund is awaitable', async () => {
    post.mockImplementation((_url, _body, cb) => {
      cb(
        null,
        'rf_p2',
        { amountCents: 10000, currency: 'USD', capturedAt: 1 },
        { requestId: 'req_p2', serverTimeMs: 1 }
      );
    });

    const paySync = new PaySync();
    const result = await paySync.refund('txn_old', {});
    expect(result).toBeTruthy();
  });

  test('P3: lookup is awaitable', async () => {
    post.mockImplementation((_url, _body, cb) => {
      cb(null, {
        txnId: 'txn_p3',
        amountCents: 100,
        currency: 'USD',
        status: 'captured',
        createdAt: 1,
      });
    });

    const paySync = new PaySync();
    const result = await paySync.lookup('txn_p3');
    expect(result).toBeTruthy();
  });

  test('P4: cancelTransaction is awaitable (resolves on completion event)', async () => {
    post.mockImplementation((_url, _body, cb) => {
      cb(null);
    });

    const paySync = new PaySync();
    const promise = paySync.cancelTransaction('txn_p4');
    setImmediate(() => paySync.emit('cancelled', { txnId: 'txn_p4' }));
    await expect(promise).resolves.toBeUndefined();
  });

  test('P5: invalid input rejects', async () => {
    const paySync = new PaySync();
    await expect(paySync.charge(-1, {})).rejects.toThrow();
  });
});
