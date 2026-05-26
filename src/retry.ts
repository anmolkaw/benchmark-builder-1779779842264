/**
 * Internal request helper.
 *
 * Wraps `httpClient.post` with the policy that's been baked into PaySync
 * since FB-201: transient transport failures get retried up to three
 * times with 100ms / 200ms / 400ms backoff before bubbling up.
 *
 * Transient failures are identified by `err._raw.transient === true`
 * on the raw error from the gateway.
 *
 * Optional `signal` short-circuits the retry chain: if the signal is
 * aborted before / between attempts, no further httpClient.post calls
 * fire and the callback is invoked with a CancellationError.
 *
 * The helper invokes its callback exactly once.
 */

import * as httpClient from './httpClient';
import { NetworkTimeoutError, CancellationError } from './errors';
import type { HttpCallback, RawError } from './httpClient';

const BACKOFF_MS = [100, 200, 400] as const;
const MAX_ATTEMPTS = 3;

function isTransient(err: RawError | null): boolean {
  return !!err && err._raw?.transient === true;
}

export function _doRequest(
  url: string,
  body: unknown,
  callback: HttpCallback,
  signal?: AbortSignal
): void {
  let attempt = 0;
  let pendingTimer: NodeJS.Timeout | null = null;
  let settled = false;

  const finish = (err: RawError | null, ...rest: unknown[]): void => {
    if (settled) return;
    settled = true;
    callback(err, ...rest);
  };

  const onAbort = (): void => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    finish(new CancellationError());
  };

  if (signal?.aborted) {
    finish(new CancellationError());
    return;
  }
  signal?.addEventListener('abort', onAbort);

  const tryOnce = (): void => {
    if (settled) return;
    if (signal?.aborted) {
      finish(new CancellationError());
      return;
    }
    attempt += 1;
    httpClient.post(url, body, (err, ...rest) => {
      if (settled) return;
      if (signal?.aborted) {
        finish(new CancellationError());
        return;
      }
      if (isTransient(err)) {
        if (attempt < MAX_ATTEMPTS) {
          const delay = BACKOFF_MS[attempt - 1];
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            tryOnce();
          }, delay);
          return;
        }
        finish(new NetworkTimeoutError({ attempts: attempt }));
        return;
      }
      finish(err, ...rest);
    });
  };

  tryOnce();
}
