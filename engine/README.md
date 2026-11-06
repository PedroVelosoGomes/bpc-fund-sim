# `/engine` — public API (v0.2.0)

Pure TypeScript. No React, DOM or I/O; the only dependency is `zod` (in `schema.ts`). Inputs and outputs are plain JSON. Every function is deterministic and does not change its inputs. This module is meant to move into Frontier, so treat everything exported from `engine/index.ts` as a public contract. Anything not exported there is internal.

## Units
- Money: numbers in **millions** of `fund.currency` (default EUR). The engine never rounds.
- Time: whole-year index from fund start (year 0). All flows happen at **year end**, and the index is the discounting period.
- Rates, probabilities and ownership are decimals (`0.25` = 25%).

## Main entry points

| Function | Purpose |
|---|---|
| `evaluateFund(model: FundModel): FundResult` | Deterministic expected-value model ("expected cash-flow case"). |
| `resolveScenario(strategy, marketCase, overrides?)` → `{ model, issues }` | Builds a `FundModel` from a scenario = (strategy, market case). |
| `evaluateCohort(cohort, fundLifeYears)` | One cohort: result, cash-flow ledger, cost releases, issues. |
| `ownershipPath(entryOwnership, cohort, bucket, policy)` | Ownership and follow-on cash, step by step, for one company. |
| `resolveEntry(entry)` / `setEntryField(entry, field, value)` | Links ticket, post-money and ownership. `ownership = ticket / postMoney`. |
| `checkEntryConsistency(t, pm, own)` | Flags imported values that disagree by more than 1pp. |
| `feeSchedule(fund, nicByYear)` | Annual management fees, with step-down. |
| `europeanWaterfall(contributions, distributions, carry)` | Whole-fund LP/GP split. |
| `irr(flows)` → `IrrResult` | Annual IRR: Newton's method with bisection fallback, and explicit N/A reasons. |
| `perturb(model, variable, value)` / `sensitivityGrid(model, x, y, metric)` | Sensitivity analysis (7×7 by default). |
| `renormaliseInto`, `setRateWithResidual`, `probabilitySum` | Keeps outcome probabilities consistent. |
| `deriveMarketCase(base, spec)` | Derives a Downside/Upside case from stage-level adjustments, keeping probabilities coherent (residual bucket absorbs). |
| `comparePolicies(cohort, fundLife)` | Cash and ownership consequences of none / pro rata / fixed follow-on for one cohort. |
| `provenanceFor(scenario, strategy, marketCase, path)` | Looks up provenance: scenario override → strategy → market-case profile. |
| `schemas.*` | Zod schemas for every persisted or imported type. |
| `presets.*` | Bright Pixel demo preset (all values are demo data). |

## Data model

```
Strategy   { fund: FundTerms, cohorts: CohortStrategy[] }        ← portfolio construction
MarketCase { kind: downside|base|upside|custom, profiles: MarketProfile[] } ← market assumptions
Scenario   { strategyId, marketCaseId, cohortOverrides, provenance }
        └─ resolveScenario ─► FundModel { fund, cohorts: CohortModel[] } ─ evaluateFund ─► FundResult
```

A `CohortStrategy` links to a `MarketProfile` by `marketProfileId`. If that id is missing, it falls back to stage + geography, then stage alone. Provenance is stored in a separate `ProvenanceMap` keyed by dotted path, so the engine's math works on plain numbers.

`FundResult` contains:
- `capital`: committed, fees, investable, reserve, invested and paid-in capital, each kept distinct.
- `gross` and `net` metrics. `net.available` is false unless both fees and carry are enabled.
- `annual` rows, including the J-curve.
- A flat `ledger` of `CashFlowLine` entries, each tagged with cohort, bucket, vintage and round, for drill-down.
- Per-`cohorts` and per-bucket contributors.
- `outlierShare`, `timeToFirstDistribution` and `issues`.

## Model in one paragraph
For each cohort, vintage (deployment year) and outcome bucket:
`companies = count × vintageWeight × probability (× recipient share for fixed follow-ons)`.
- Initial tickets are placed at the vintage year.
- Follow-on cash goes into the rounds the bucket reaches, at vintage + round year.
- Proceeds = `companies × exit ownership × equity exit value`, placed at vintage + years to exit.

Fees are charged on commitments during the investment period, then on the prior year's net invested capital. They are called from LPs and reduce investable capital. LP contributions (investments + fees) and proceeds go through the European waterfall.
