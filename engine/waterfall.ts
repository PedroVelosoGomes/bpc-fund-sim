import type { CarryTerms, WaterfallTotals } from './types';

export interface WaterfallResult {
  lpDistributions: number[];
  gpCarry: number[];
  totals: WaterfallTotals;
}

/**
 * European (whole-fund) distribution waterfall, run year by year on fund-level cash.
 *
 * Tiers applied to each year's gross distributions, after that year's contributions:
 *  1. Return of capital + compounding preferred return: 100% to LPs until the hurdle balance is cleared.
 *     Hurdle balance B_t = B_{t−1}·(1+h) + contributions_t − LP distributions_t. B is allowed to go negative
 *     (LPs ahead of the hurdle), which makes the test equivalent to "LP IRR ≥ h".
 *  2. GP catch-up: `catchUpRate` of each euro to the GP until the GP holds `carryRate` of cumulative profit
 *     (profit = cumulative distributions − cumulative contributions).
 *  3. Split: (1 − carryRate) to LPs, carryRate to the GP.
 * At the final year a clawback caps total GP carry at carryRate × max(0, total profit).
 *
 * @param contributions LP capital paid in per year (positive numbers: investments + fees).
 * @param distributions gross distributable proceeds per year (positive numbers).
 */
export function europeanWaterfall(contributions: number[], distributions: number[], carry: CarryTerms): WaterfallResult {
  const n = Math.max(contributions.length, distributions.length);
  const lp = new Array(n).fill(0);
  const gp = new Array(n).fill(0);
  const totals: WaterfallTotals = {
    lpDistributions: 0,
    gpCarry: 0,
    returnOfCapital: 0,
    preferredReturn: 0,
    catchUp: 0,
    splitToLp: 0,
    splitToGp: 0,
    clawback: 0,
  };
  if (!carry.enabled) {
    for (let t = 0; t < n; t++) lp[t] = distributions[t] ?? 0;
    totals.lpDistributions = lp.reduce((a, b) => a + b, 0);
    return { lpDistributions: lp, gpCarry: gp, totals };
  }
  const c = carry.carryRate;
  const h = carry.hurdleRate;
  const k = carry.catchUpRate;

  let B = 0; // hurdle balance
  let capitalOutstanding = 0;
  let CC = 0; // cumulative contributions
  let LPcum = 0;
  let GPcum = 0;

  for (let t = 0; t < n; t++) {
    const C = contributions[t] ?? 0;
    B = B * (1 + h) + C;
    capitalOutstanding += C;
    CC += C;
    let D = distributions[t] ?? 0;

    // Tier 1: return of capital, then preferred return
    if (D > 0 && B > 0) {
      const x = Math.min(D, B);
      const roc = Math.min(x, capitalOutstanding);
      capitalOutstanding -= roc;
      totals.returnOfCapital += roc;
      totals.preferredReturn += x - roc;
      lp[t] += x;
      LPcum += x;
      B -= x;
      D -= x;
    }
    // Tier 2: catch-up
    if (D > 0 && k > c) {
      const needed = (c * (LPcum + GPcum - CC) - GPcum) / (k - c);
      if (needed > 0) {
        const x = Math.min(D, needed);
        const toGp = k * x;
        const toLp = (1 - k) * x;
        gp[t] += toGp;
        GPcum += toGp;
        lp[t] += toLp;
        LPcum += toLp;
        B -= toLp;
        totals.catchUp += toGp;
        totals.splitToLp += toLp;
        D -= x;
      }
    }
    // Tier 3: split
    if (D > 0) {
      const toGp = c * D;
      const toLp = D - toGp;
      gp[t] += toGp;
      GPcum += toGp;
      lp[t] += toLp;
      LPcum += toLp;
      B -= toLp;
      totals.splitToGp += toGp;
      totals.splitToLp += toLp;
    }
  }

  // Clawback true-up at the final year.
  const profit = LPcum + GPcum - CC;
  const cap = c * Math.max(0, profit);
  if (GPcum > cap + 1e-9 && n > 0) {
    const excess = GPcum - cap;
    gp[n - 1] -= excess;
    lp[n - 1] += excess;
    GPcum -= excess;
    LPcum += excess;
    totals.clawback = excess;
  }
  totals.lpDistributions = LPcum;
  totals.gpCarry = GPcum;
  return { lpDistributions: lp, gpCarry: gp, totals };
}

export const EUROPEAN_CONVENTION_LABEL = (carry: CarryTerms) =>
  `European whole-fund waterfall: return paid-in (incl. fees) → ${(carry.hurdleRate * 100).toFixed(0)}% compounding pref → ${(
    carry.catchUpRate * 100
  ).toFixed(0)}% GP catch-up → ${((1 - carry.carryRate) * 100).toFixed(0)}/${(carry.carryRate * 100).toFixed(0)} split`;
