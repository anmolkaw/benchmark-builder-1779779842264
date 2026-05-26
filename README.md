# Benchmark Builder Interview — Nextdev Labs

You have **30 minutes**. There are two parts, and the order is up to you.

Nextdev Labs builds production-realistic benchmarks that measure where frontier coding agents fail on real fintech APIs. We hire engineers to author those benchmarks — the hard part of the job is **picking a worthwhile benchmark to build** and **designing test cases that actually catch the specific ways AI gets it wrong**.

This interview is designed to see how you operate when both halves of that job are in front of you at once.

---

## Part 1 — Benchmark proposal

Open `PROPOSAL.md` (it's pre-templated at the project root) and write a 1-page proposal for a benchmark you'd build for Nextdev Labs. Follow the template — the sections are required so we can compare submissions fairly.

We're looking for:

- A **specific** fintech-API surface (Stripe, Adyen, Plaid, etc.) where you know or strongly suspect coding agents fail.
- A **concrete failure mode** rooted in how a real codebase uses that API — not a generic "AI sometimes gets idempotency wrong" claim.
- **Test cases** that each name (a) what they assert and (b) the naive AI implementation they're designed to catch.
- A **realistic difficulty prediction** — how often you think a frontier model (e.g. Claude Sonnet 4.6, best-of-3) would pass the benchmark.

The strongest proposals draw on a failure you've personally hit in a production integration. The weakest are generic.

---

## Part 2 — Coding task

Refactor the callback-style payments client in `src/paysync.ts` to a modern async/await API. The four public methods (`charge`, `refund`, `lookup`, `cancelTransaction`) should become `async` functions while preserving every observable behavior of the existing implementation.

- Public test suite in `tests/paysync.public.test.ts` shows the basic shape you're working toward.
- Hidden tests grade your submission.
- **AI pair-programming is expected.** This part is here to verify you can direct AI to ship correct TypeScript under time pressure, not to test you on writing the code by hand.

### Setup

```bash
npm install
npm test
```

---

## Submission

Submit both parts in the same project zip — `PROPOSAL.md` lives at the project root and ships with everything else. Both parts are graded.
