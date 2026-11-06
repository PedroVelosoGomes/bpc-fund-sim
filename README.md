# Bright Pixel Capital — VC Fund Simulator

A fund-construction simulator for investment professionals. It runs a deterministic expected-value engine over deal cohorts, outcome buckets, follow-on policies, fees and a European carry waterfall.

> **Status: Phase 1 of 5** — the engine and demo preset are complete and tested. The UI is a placeholder fund summary. The three-area workspace, benchmark import and strategy search come in phases 2–4.

## Run
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest engine tests
```

## Layout
- `engine/` — pure TS calculation engine. Its public API is documented in [`engine/README.md`](engine/README.md), and tests are in `engine/__tests__`.
- `src/` — React app (Vite).
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
