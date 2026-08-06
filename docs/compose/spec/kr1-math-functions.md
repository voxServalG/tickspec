---
feature: kr1-math-functions
status: delivered
updated: 2026-08-07
branch: feat/kr1-math-functions
commits: a9cb6b4..fed1250
---

# KR1: Scalar Math Functions

## Report

**What was built** — 7 scalar math functions registered in the validator whitelist: `abs`, `sign`, `sqrt`, `log`, `exp` (unary) and `min`, `max` (binary). Each function has type inference (returns `number`), arity validation (unary=1, binary=2), and type validation (arguments must be `number`). The implementation follows the existing `cross_over`/`clamp` pattern in `validator.ts`.

**Verification** — `npm run typecheck` PASS, `npm run lint` PASS, `npm test` 57 passed (7 test files). Review found 2 minor findings (missing TYPE_MISMATCH test for binary functions, error code naming inconsistency); the missing test was added.

**Journey log**:
- YAML parser can't handle commas in scheduled_checks emit arrays (e.g., `[min(x, y) > 0, 0.5]`); switched binary function tests to use triggers instead
- `noUncheckedIndexedAccess` requires `&& guard` on every `e.args[n]` access; followed existing `cross_over` pattern
- When adding function validators, both `inferExprType` (return type) AND `checkExpr` (validation) must be updated; missing either breaks downstream

## [S1] Problem
tickspec's expression system only has `cross_over()` and `clamp()` as built-in functions. This is insufficient for describing quantitative signals that require basic math operations (absolute value, logarithm, exponential, etc.).

## [S2] Design
Register 7 scalar math functions in the validator whitelist, grouped by arity:

**Unary functions (1 argument)**:
- `abs(number) → number` — absolute value
- `sign(number) → number` — sign function (-1/0/+1)
- `sqrt(number) → number` — square root
- `log(number) → number` — natural logarithm
- `exp(number) → number` — exponential function

**Binary functions (2 arguments)**:
- `min(number, number) → number` — minimum
- `max(number, number) → number` — maximum

All functions:
- Accept only `number` type arguments (not `bool`)
- Return `number` type
- Have fixed arity (unary: 1, binary: 2)
- Are registered in the validator's function whitelist

Excluded (per OKR.md minimum scope analysis):
- `ceil`, `floor`, `round` — formatting operations, not signal logic
- `pow` — rare, expressible as `exp(n * log(x))`
- Trigonometric functions — irrelevant for quant signals

## [S3] Out of Scope
- Time series functions (KR2)
- Semantic technical indicators (KR3)
- New syntax or IR format changes

## Tasks
- [x] T1: Register functions in validator whitelist — acceptance: validator accepts valid calls, rejects invalid ones (covers: S2)
- [x] T2: Add type inference for KR1 functions — acceptance: inferExprType returns 'number' for all KR1 functions (covers: S2)
- [x] T3: Add arity validation — acceptance: wrong number of arguments produces ARITY error (covers: S2)
- [x] T4: Add type validation — acceptance: non-numeric arguments produce TYPE_MISMATCH error (covers: S2)
- [x] T5: Add tests — acceptance: 21 new test cases covering accept/reject for each function (covers: S2)
