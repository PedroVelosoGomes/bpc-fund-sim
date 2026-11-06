# Bright Pixel Capital — VC Fund Simulator

A fund-construction simulator for investment professionals. It runs a deterministic expected-value engine over deal cohorts, outcome buckets, follow-on policies, fees and a European carry waterfall.

> **Status: Phase 2 of 5.**
> - Done: engine, demo preset, three-area workspace (editor, comparison, drill-down) and local persistence.
> - Next: benchmark import (phase 3), then strategy search (phase 4).

## Run
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest engine tests
```

## Using it
1. On first load, choose **Load demo data**. It contains Balanced and Concentrated strategies under demo Downside, Base and Upside cases, all labelled as demo data.
2. **Left panel:**
   - Scenario list: tick up to 3 to compare, ⧉ to clone, and one click to switch every compared scenario to the same market case.
   - Editor for the focused scenario: fund terms, sleeves, and cohorts.
   - Cohorts set entry terms (any two of ticket, post-money and ownership), deployment, follow-on policy, rounds and outcome buckets.
3. **Center:**
   - Compare table with deltas vs the first column, plus the J-curve.
   - Annual cash flows, proceeds by cohort × outcome, reserve view, and a sensitivity heatmap.
4. **Right:** drill-down. Click any metric, chart bar, cohort, bucket or year to see what produced it, with provenance on every input.

**Hover any number** to see its provenance. Styling shows the source:
- benchmark: solid blue underline
- demo data: dashed grey underline
- user override: violet bar
- default: no styling

**Saving:**
- Strategy edits (fund, cohort construction) go to that scenario's own strategy copy.
- Market-side edits (rounds, dilution, buckets) are saved as **scenario overrides**. The shared market case is never modified, and "Revert to market case" removes the overrides.
- Outcome buckets are edited as a draft. **Save is blocked until probabilities sum to 100%**, and "renormalise into bucket X" is offered.
- The workspace is saved to IndexedDB with a schema version and migrations (`src/state/persistence.ts`).

## Layout
- `engine/` — pure TS calculation engine. Its public API is documented in [`engine/README.md`](engine/README.md), and tests are in `engine/__tests__`.
- `src/state/` — Zustand store (copy-on-write edits), memoised results, IndexedDB persistence and migrations, demo workspace.
- `src/components/` — `ScenarioList`, `editor/` (fund, cohorts, buckets), `center/` (comparison, charts, sensitivity), `drill/` (drill-down panel).
- `ASSUMPTIONS.md` — every decision made where the spec was silent.

## The model in one page
**Inputs.** The fund terms are:
- committed capital, investment period and fund life
- fee schedule and carry terms
- reserve
- sleeves

Each **cohort** has:
- a company count and a deployment profile
- entry terms: two of ticket, post-money and ownership, with the third derived
- a follow-on policy: none, pro rata, or a fixed ticket into selected buckets
- a round schedule
- outcome **buckets**: probability, years to exit, equity value (or revenue × multiple − net debt), rounds reached, and dilution

**Expected cash flows.** For each cohort × vintage × bucket:
- expected companies = count × vintage weight × probability
- investments: the ticket at entry, and follow-ons in each round the bucket reaches (so follow-on cost depends on the outcome)
- proceeds = companies × exit ownership × equity value, placed at entry + years to exit

All results are labelled **"expected cash-flow case"**. The IRR of expected cash flows is not the average IRR of simulated paths.

**Capital.** Committed → (− lifetime fees) → investable → (− separate sleeves) → direct investable → (− reserve) → initial budget.
- Invested = initial + follow-ons.
- Paid-in = invested + fees.

**Metrics.**
- Gross MOIC = proceeds / invested.
- Gross IRR is computed on investment and proceeds flows only.
- Net LP multiple and net IRR come from LP flows after the waterfall. They need both fees and carry enabled; otherwise they show "N/A — enable fees and carry".
- Also reported: J-curve, time to first distribution, outlier share, and a 7×7 sensitivity grid.

## Conventions
- **IRR:** annual periods, all flows at year end, Newton's method with bisection fallback. N/A when there is no sign change or no unique root.
- **Fees:** % of commitments during the investment period, then % of the prior year-end net invested capital. Fees are called from LPs and reduce investable capital. No recycling.
- **Carry:** European whole-fund waterfall. Return all paid-in capital (incl. fees) → 8% compounding pref → 100% GP catch-up → 80/20. Final clawback.
- **Dilution:**
  - Quick mode: exit ownership = entry × (1 − cumulative dilution).
  - Explicit mode: each round dilutes by size / post-money.
  - Pro rata holds ownership constant through reached rounds, at a cost of ownership × round size.

## Known limitations (v1)
- Separate-use sleeves are not modelled as cash flows.
- There is no recycling, no GP commitment, no fund expenses beyond management fees, and no interim carry escrow (only a final clawback).
- Expected-value only until the optional Monte Carlo phase.
- Whole-year timing only.
