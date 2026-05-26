# Benchmark Proposal: PaySync Async Migration Reliability

## 1. API surface

PaySync payment client migration for four money-moving methods: `charge`, `refund`, `lookup`, and `cancelTransaction`. The benchmark asks an AI agent to migrate a callback-style TypeScript SDK to Promise-based async/await while preserving method names, exported types, validation behavior, custom errors, retry behavior, cancellation behavior, response mapping, and TypeScript compatibility.

## 2. Why coding agents fail here

Payment SDK migrations look easy on the happy path, so agents often wrap callbacks in `new Promise` and stop there. That misses production-critical edge cases: duplicate gateway callbacks, aborts during retry backoff, structured gateway errors that must stay typed, and cancellation flows where request submission is not the same thing as provider-confirmed cancellation. In a real checkout or operations dashboard, those mistakes can double-settle requests, leak listeners, hide retry hints, or mark an indeterminate transaction as safely cancelled.

## 3. Test cases (3-5)

#### Test 1: Duplicate callback resolution
- Asserts: `charge`/`refund` resolve exactly once with the first gateway response and ignore later duplicate callbacks.
- Catches: a naive Promise wrapper that does not guard callback re-entry or cleanup.
- Senior instinct: settle-once discipline around any external payment callback.

#### Test 2: Abort during retry backoff
- Asserts: aborting an in-flight request rejects with `CancellationError`, clears pending retry timers, and prevents further HTTP attempts.
- Catches: accepting `signal?: AbortSignal` in types but never wiring it into the retry chain.
- Senior instinct: cancellation must be observable, prompt, and cleanup-oriented.

#### Test 3: Custom error preservation
- Asserts: gateway `_raw` payloads still translate to `RateLimitError` and `InsufficientFundsError` with their diagnostic fields intact.
- Catches: converting all callback failures to generic `Error` rejections.
- Senior instinct: API compatibility includes error classes and observability payloads.

#### Test 4: Cancel transaction two-stage settlement
- Asserts: `cancelTransaction` resolves only after the cancellation request succeeds and the matching `cancelled` event is emitted.
- Catches: resolving immediately when `/v1/cancellations` accepts the request.
- Senior instinct: provider state machines have submission and completion phases.

#### Test 5: Export surface compatibility
- Asserts: existing named exports, option types, and error classes remain available after the async refactor.
- Catches: default-export rewrites, renamed instances, or deleted legacy types.
- Senior instinct: migrations should be additive unless the public contract explicitly changes.

## 4. Frontier-model pass-rate prediction

Strong frontier coding agents would pass about 60-70% of hidden cases on the first attempt because the happy-path async migration is straightforward, but duplicate settlement, abort cleanup, custom error translation, and two-stage cancellation require careful specification reading rather than mechanical refactoring.

## 5. Why this is a production-realistic problem

Fintech teams routinely modernize old SDKs while dashboards, reconciliation jobs, and support tooling still depend on precise legacy semantics. The benchmark mirrors the kind of migration where a tiny async bug can affect charges, refunds, and cancellation visibility in production.
