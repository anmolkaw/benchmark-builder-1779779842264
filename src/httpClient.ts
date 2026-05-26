/**
 * Internal HTTP wrapper.
 *
 * In production this would speak to the PaySync API gateway. In the
 * test harness it is mocked at the module boundary via
 * `jest.spyOn(httpClient, 'post')`.
 *
 * Callers MUST consume this module via a namespace import:
 *
 *     import * as httpClient from './httpClient';
 *     httpClient.post(url, body, callback);
 *
 * Destructured imports capture the original function reference at
 * import time and would bypass the spy.
 *
 * The callback receives raw HTTP results: `cb(err)` on transport
 * failure, or `cb(null, ...positionalResponseFields)` on success. Each
 * upstream endpoint has its own response shape; charges/refunds reply
 * with three positional fields (id, receipt, metadata), lookup with
 * one (the transaction object), cancellations with none.
 *
 * On transport / server errors, `err` is a plain `Error` with an
 * attached `_raw` field that carries the wire-level diagnostic — the
 * upstream gateway's response code, retry hints, balance hints, etc.
 * Callers translate `err._raw` into typed PaySync error subclasses.
 */

export interface RawErrorMetadata {
  code?: number;
  retryAfter?: number;
  balance?: number;
  fieldErrors?: Record<string, string>;
  transient?: boolean;
}

export interface RawError extends Error {
  _raw?: RawErrorMetadata;
}

export type HttpCallback = (
  err: RawError | null,
  ...rest: unknown[]
) => void;

export function post(
  _url: string,
  _body: unknown,
  callback: HttpCallback
): void {
  // The default implementation is intentionally a no-op stub. Tests
  // replace it via jest.spyOn before exercising any code path that
  // would otherwise hit the network.
  setImmediate(() => {
    callback(new Error('httpClient.post not mocked — wire up the test harness'));
  });
}
