# Benchmark Proposal

> Replace each placeholder section with your answer. Keep it to roughly one printed page total. Concrete > abstract — pick a specific failure mode, not a topic area.

---

## 1. API surface

Which fintech API and which feature/integration are you proposing a benchmark for? Be specific (e.g. "Stripe Connect — application_fee handling on partial refunds" rather than "Stripe payments").

> _your answer here_

---

## 2. Why coding agents fail here

What's the concrete failure mode? What does a naive AI implementation typically get wrong? If you've hit this in production, say so — and what the bug looked like.

> _your answer here_

---

## 3. Test cases (3–5)

For each test, give:
- **What it asserts** (the observable behavior being checked)
- **The naive AI implementation it catches** (the wrong-but-plausible code path an agent would write)
- **The senior instinct the test rewards** (what someone with production experience would know to do differently)

#### Test 1
- Asserts:
- Catches:
- Senior instinct:

#### Test 2
- Asserts:
- Catches:
- Senior instinct:

#### Test 3
- Asserts:
- Catches:
- Senior instinct:

#### (Test 4, Test 5 — add if useful)

---

## 4. Frontier-model pass-rate prediction

How often do you think a frontier coding model (e.g. Claude Sonnet 4.6, best-of-3 with a Goose-style harness) would pass the full benchmark? Give a rough percentage and one sentence on why. The point isn't to be exactly right; it's to show you've thought about calibration.

> _your answer here_

---

## 5. Why this is a production-realistic problem

Why does this matter to a real team using this API? What system / use case would actually run into it? (One or two sentences.)

> _your answer here_
