---
feature: kr2-kr3-kr4
status: delivered
updated: 2026-08-07
branch: feat/kr2-kr3-kr4
commits: f293b2f..HEAD
---

# KR2/KR3/KR4: Time Series, Technical Indicators, and Language Invariants

## Report

**What was built** — Extended tickspec's type system with `series` type for time series data. Registered 7 time series primitives (KR2) and 6 semantic technical indicators (KR3) in the validator whitelist. Updated type inference so factors resolve as `series`, arithmetic/comparison operators accept `series`, and scalar functions (KR1) return `series` when given `series` inputs. Added 36 new test cases covering accept/reject scenarios for all functions.

**Verification** — `npm run typecheck` PASS, `npm run lint` PASS, `npm test` 93 passed (7 test files).

**Journey log**:
- Factors must resolve as `series` (not `number`) because they represent time series data
- KR1 functions (abs, min, max, etc.) must accept both `number` and `series` to remain composable with time series
- `cross_over` and `clamp` also updated to accept `series` first argument
- Arithmetic operators (`+`, `-`, `*`, `/`) now accept mixed `number`/`series` operands

## [S1] Problem
tickspec can only reference current-bar factor values. It cannot express time series operations (lag, rolling mean) or semantic technical indicators (RSI, MACD). The type system also needs a `series` type to distinguish scalars from time series.

## [S2] Design

### KR2: Time Series Primitives (7 functions)
Add `series` type to the type system. Register 7 functions:

| Function | Signature | Description |
|----------|-----------|-------------|
| `lag` | `(series, number) → series` | n-period lag |
| `change` | `(series, number) → series` | x - x[n] |
| `pct_change` | `(series, number) → series` | x/x[n] - 1 |
| `rolling_mean` | `(series, number) → series` | rolling mean |
| `rolling_std` | `(series, number) → series` | rolling std dev |
| `rolling_min` | `(series, number) → series` | rolling min |
| `rolling_max` | `(series, number) → series` | rolling max |

Type system changes:
- `ValType` becomes `'number' | 'bool' | 'series' | 'unknown'`
- Factor declarations (`#number`) resolve to `series` type (factors are time series)
- Scalar functions (KR1) return `number` for `number` inputs, `series` for `series` inputs
- Arithmetic operators (`+`, `-`, `*`, `/`) accept `series` operands and return `series`
- Comparisons (`<`, `<=`, `>`, `>=`) accept `series` and return `bool`

### KR3: Semantic Technical Indicators (6 functions)
Register 6 industry-standard indicators:

| Function | Signature | Description |
|----------|-----------|-------------|
| `ema` | `(series, number) → series` | exponential moving average |
| `rsi` | `(series, number) → series` | relative strength index |
| `macd` | `(series, number, number, number) → series` | MACD |
| `bollinger_upper` | `(series, number, number) → series` | Bollinger upper band |
| `bollinger_lower` | `(series, number, number) → series` | Bollinger lower band |
| `atr` | `(series, series, series, number) → series` | average true range (high, low, close, n) |

### KR4: Language Invariants
All 28 invariants from OKR.md are enforced in validator. Test coverage added for KR2/KR3 function validation.

## [S3] Out of Scope
- Execution layer (how functions are computed)
- New IR format (functions are just `{"type": "call", "name": "..."}` in IR)
- OHLCV data source (registered as factor types, source doesn't matter)

## Tasks
- [x] T1: Add `series` type to ValType — acceptance: type system compiles with new type (covers: S2)
- [x] T2: Update factor declarations to resolve as `series` — acceptance: `#number` factors become `series` type (covers: S2)
- [x] T3: Update arithmetic/comparison operators for `series` — acceptance: `series + series` works, `series > 0` works (covers: S2)
- [x] T4: Register KR2 functions (7) — acceptance: validator accepts valid calls, rejects invalid ones (covers: S2)
- [x] T5: Register KR3 functions (6) — acceptance: validator accepts valid calls, rejects invalid ones (covers: S2)
- [x] T6: Add KR2 tests — acceptance: 28 test cases for time series functions (covers: S2)
- [x] T7: Add KR3 tests — acceptance: 8 test cases for semantic indicators (covers: S2)
- [x] T8: Verify KR4 invariants — acceptance: all 28 invariants have test coverage (covers: S2)
- [x] T9: Update docs/README.md — acceptance: function tables updated (covers: S2)
