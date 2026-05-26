/**
 * Legacy cancellation token.
 *
 * The original PaySync client predates the AbortController standard; it
 * shipped a hand-rolled cancellation token in the same release as the
 * callback API. The interface is intentionally minimal:
 *
 *     const token = createCancellationToken();
 *     paySync.charge(amount, { cancellationToken: token }, cb);
 *     // later...
 *     token.cancel();
 *
 * If `cancel()` is called while a request is in flight, the request's
 * callback fires once with a `CancellationError` and any subsequent
 * `httpClient` callbacks are dropped.
 */

export interface CancellationToken {
  cancel(): void;
  isCancelled(): boolean;
  onCancel(fn: () => void): void;
}

export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  const listeners: Array<() => void> = [];

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      for (const fn of listeners) {
        try {
          fn();
        } catch {
          // Swallow — listener exceptions must not block other listeners.
        }
      }
    },
    isCancelled(): boolean {
      return cancelled;
    },
    onCancel(fn: () => void): void {
      if (cancelled) {
        try {
          fn();
        } catch {
          // ignore
        }
        return;
      }
      listeners.push(fn);
    },
  };
}
