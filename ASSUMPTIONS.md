# ASSUMPTIONS

Decisions made where the spec was silent or ambiguous. Each has a one-line rationale.

## Time and cash flows
1. **Year index = discount period.** A flow in "year t" is discounted by (1+r)^t, so year-0 flows are undiscounted. *This matches the hand-verified Example A IRR (−20 at year 0).*
2. **Fund life L means a terminal year of L.** Exits up to year L are inside the fund life. Fee years run 0…L−1, so there are L annual fee charges. *Standard 10-year fund with 10 annual fees.*
3. **Exits after the fund life are still counted** in their year, with a warning. *Excluding them would silently destroy value; the user decides whether to extend the fund.*
4. **All timings must be whole years.** Non-integer timings raise an error. *The spec says time is in whole years.*

## Fees
5. Default fees are **2.0% of commitments during the investment period and 1.5% of net invested capital afterwards**. *Common European early-stage terms.*
6. **Post-period basis = net invested capital (NIC) at the end of the previous year.** NIC = cost of initial plus follow-on investments in companies not yet exited or written off. Cost basis is released in the bucket's exit year, including write-offs. *Standard NIC definition. The fee for a year is set from the opening balance.*
7. **Investable capital = committed − lifetime fees.** Fees are called in the year they accrue. *As the spec requires (fees reduce investable capital, no recycling).*

## Carry
8. **The European waterfall runs year by year with a compounding hurdle balance.** B_t = B_{t−1}(1+h) + contributions − LP distributions. B may go negative, which makes the test equivalent to "LP IRR ≥ hurdle". *This handles fee calls that happen after early distributions.*
9. **Catch-up rate is a parameter (default 100%).** GP receives that share until it holds carry% of cumulative profit. *The general formula reduces to the spec's 100% case.*
10. **A final clawback caps GP carry at carry% × total profit.** It is applied in the last year. *Prevents over-distribution when fees are called after the hurdle is met. No interim escrow is modelled.*
11. **Net metrics require both fees and carry to be enabled.** A no-fee fund with carry also shows N/A. *As written in the spec.*

## Reserve and capital
12. **Percent reserve = % of investable capital** (after fees). *Matches the spec wording.*
13. **Initial budget = investable − separate-use sleeves − reserve.** Initial overruns warn. Total investments above direct investable capital raise an **error** (shown but not blocking). Reserve over-allocation **warns**. *The spec says warn on reserve, validate on total.*
14. **Reserve is compared with *expected* planned follow-ons**, both cumulatively by year and in total. *The expected-value model gives the planned requirement.*
15. **Separate-use sleeves (e.g. Ecosystem) are not modelled as cash flows** in v1. They are not called, carry no proceeds, and are excluded from gross and net metrics. They only reduce direct investable capacity. *There is no spec for how that capital is used. Listed as a limitation.*
16. **The sleeve gap is reported, never auto-corrected.** Sleeve total − investable is shown when fees are on. *The spec says never adjust silently. Scaling helpers belong to the UI layer.*

## Dilution and follow-ons
17. **Round schedule is per cohort/profile.** A bucket reaches the first `roundsReached` rounds. *The simplest representation of "how many rounds the company reaches".*
18. **Quick mode with no participation:** exit ownership = entry × (1 − cumulative dilution), regardless of the round schedule. *Exact match to the spec formula.*
19. **Quick mode with participation (pro rata or fixed):** the cumulative dilution is split into modelled-round dilution and residual dilution, where residual factor = (1 − cum)/Π(1 − d_i), capped at 1. Pro rata offsets only the modelled-round part. *Keeps quick mode consistent with the explicit round schedule that follow-on cash needs.*
20. **In explicit mode, `cumulativeDilution` is extra unmodelled dilution** (ESOP top-ups etc., default 0), applied before exit. *Makes room for option-pool dilution without inventing rounds.*
21. **Follow-on policies always use the round schedule** for timing, size and price. That applies in quick mode too. *Cash needs a round size and a price.*
22. **Fixed follow-on coverage:** each eligible bucket receives it with share min(1, fraction ÷ Σ eligible probability). There is a warning if the fraction exceeds eligible probability, or if an eligible bucket doesn't reach the chosen round. *This reads "fixed ticket into X% of the cohort, chosen from buckets B" literally.*
23. **The fixed ticket buys ticket/round post-money** at the chosen round (default: the first). It is diluted by later rounds. *Priced like any participation in that round.*
24. **Max single-company exposure = ticket + largest per-company follow-on across buckets.** *Uses the worst-case plan, as used for concentration limits.*

## Exits and probabilities
25. **Equity exit value is floored at 0** when net debt exceeds EV (with a warning). *Equity holders can't receive negative proceeds.*
26. **Probability tolerance is 1e-6.** The default residual bucket is the first bucket of kind `modest`. *As the spec requires.*

## IRR
27. **Root scan over r ∈ (−99.99%, 100,000%) on a log grid** when the flows have more than one sign change. More than one NPV sign change gives N/A ("no unique IRR"), even if the extra root is near −100%. *The spec says show N/A when there is no unique root.*

## Data model
28. **Provenance lives in a separate map keyed by dotted path**, not wrapped around each number. *Keeps the engine's arithmetic on plain numbers and keeps the API simple.*
29. **Scenario = (strategy, market case) plus per-cohort market overrides.** Entry valuation (post-money) belongs to the strategy. The market profile carries the acceptable post-money range used by strategy search. *Strategy picks ticket and ownership. The market bounds price.*

## Demo preset
30. **Bright Pixel demo:** 18 seed companies (€3M at €15M, pro rata, explicit A/B rounds) in Ownership, and 27 pre-seed companies (€2M at €12M, quick dilution, fixed €3M follow-on into strong exits and outliers) in Exploration. Both are deployed over years 0–3. Reserve is 35%. Ecosystem is a separate use of capital. *Fits the spec ranges: 45 companies and €108M initial deployment. All market values are demo data.*

## Phase 2 — workspace, editing, comparison
31. **Each scenario owns its strategy copy.** Clone forks the strategy, so editing one scenario never changes another. A scenario is still (strategy, market case), and market cases are shared. *This is the safest reading of "clone and edit". Running two strategies under one case is done by switching their market case.*
32. **Market-side edits are per-scenario overrides.** Edits to rounds, dilution mode and buckets for a cohort are stored on the scenario (`cohortOverrides`) and never written to the shared market case. *Lets one scenario deviate without silently changing every scenario on that case.*
33. **Bucket edits are buffered.** Save is blocked until probabilities sum to 100% (±1e-6). Other inputs commit on blur or Enter, and the results update right away. *The spec requires blocking saves on invalid probabilities, and immediate feedback is better for the other inputs.*
34. **Provenance lookup order:** scenario override → strategy → market-case profile → "default". The first user edit records the previous provenance, shown as "was …". *Where a number came from stays traceable after an override.*
35. **Compare is capped at 3.** Deltas are shown against the first compared column, and a delta that rounds to zero is hidden. *The spec says three. The first column acts as the reference.*
36. **The J-curve uses cumulative LP net cash flow.** That is after fees and carry when both are on. If either is off, it is proceeds − paid-in, labelled "before carry". *An LP-perspective J-curve is the standard view.*
37. **Sensitivity runs on the main thread.** A 9×9 grid is 81 engine runs, each well under 1ms. *A worker is reserved for strategy search in phase 4.*
38. **Demo Downside/Upside cases come from demo low/base/high ranges.** Downside uses low exit values, high write-off, +1 year to exit and 1.2× dilution. Upside mirrors it. Both are labelled demo data and as assumption bundles, not percentiles. *Gives a working Downside/Base/Upside comparison before benchmark import (phase 3) replaces the ranges.*
39. **Chart colours follow the validated reference palette.** Its first three categorical slots match the three-scenario cap, there is one accent (blue), and the heatmap uses a single-hue blue sequential ramp. *Colour-blind-safe in both themes.*
40. **Persistence:** one IndexedDB record holds the workspace and UI preferences, with `schemaVersion`. Saves are debounced by 300ms. If saved data can't be read, it is copied to a backup key before starting fresh. *Never silently drop a user's work.*

## Phase 3 — benchmark import and case generation
41. **Bucket-level metrics take an optional `_<bucket>` suffix** (`time_to_exit_outlier`, `exit_equity_value_modest` …), matched by bucket kind, id or label. A suffixed row beats an unsuffixed one. An unsuffixed exit-value or timing row applies to every non-write-off bucket. An unsuffixed cumulative-dilution row applies to every bucket. *The spec's schema has no bucket column, but per-bucket exits are what the model needs.*
42. **Matching:** stage must match (or the row's stage is a wildcard: blank, `*`, `any`). Then geography: exact, then wildcard or blank, then a different geography. A different geography is still usable but flagged. Then vintage, closest to the fund's `vintageYear`, with rows that have no vintage ranked last. *The spec's order is stage → geography → vintage. A flagged fallback is more useful than no match.*
43. **Rows that tie on every ranking criterion need a user choice**, even if their values are equal. Generation is blocked until every tie is resolved. *The spec says to require a choice.*
44. **Currency mismatch blocks the row. Scale differences convert with a visible flag.** Scale means k/m/bn, or months → years. A money unit with no currency is read as the fund currency, with a warning. *No silent FX. A scale change is arithmetic, not FX.*
45. **Rates accept `pct` (÷100) or `fraction`.** A rate outside 0–100% after conversion blocks the row, which catches pct/fraction mix-ups. *Prevents a 20 being read as 2,000%.*
46. **Missing low/high fall back to base**, with an info flag. A row is blocked unless low ≤ base ≤ high. *Lets point estimates in without inventing a range.*
47. **Generated cases copy their structure from an existing market case**: bucket layout, round schedule and rounds reached. Benchmark rows overwrite the values they match. Unmatched values keep the structure case's value and provenance. *A pack has no information about bucket layout or rounds.*
48. **Entry benchmarks (ticket, post-money, ownership) apply only to the strategies you tick, at base value.** If ticket and post-money are both present they win and ownership is derived; a disagreeing ownership row is flagged. *Entry terms are strategy choices, not market cases. Ticket and post-money are the observed quantities.*
49. **The entry post-money range (low–high) is saved on the market profile** as the acceptable valuation range. It is the same in all three cases and is used by strategy search in phase 4. *The spec says candidates must imply a post-money inside the benchmark range.*
50. **Dilution per round sets every modelled round's post-money** to round size ÷ dilution, keeping the size. *Keeps follow-on cash (ownership × round size) comparable across cases.*
51. **A benchmark outcome rate for the residual bucket is ignored**, with an info flag, because the residual absorbs the remainder. A negative residual blocks saving and is shown in red in the preview. *Probabilities must stay coherent.*
52. **Percentile reading is opt-in:** a checkbox on import, or `percentileBacked: true` in JSON. Otherwise cases are labelled "assumption bundle, not a statistical percentile". *The spec says only when the benchmark explicitly supports it.*
53. **Workspace schema v2 adds `benchmarks`**, with migration v1 → v2. The fund gains an optional `vintageYear` (demo: 2025). *Packs persist with the workspace, and vintage matching needs a fund vintage.*
54. **The CSV template can be downloaded where the browser allows it, and copied everywhere.** *The hosted single-page version blocks file downloads.*
