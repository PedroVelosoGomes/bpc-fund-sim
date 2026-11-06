import type { FeeTerms, FundTerms } from './types';

/**
 * Management fee schedule.
 *
 * Fee years are 0 .. fundLifeYears−1; the fee for year t is called at year-end t (same convention as all flows).
 *  - t < investmentPeriodYears: investmentPeriodRate × committed capital.
 *  - t ≥ investmentPeriodYears: postPeriodRate × basis, where basis is committed capital or the net invested
 *    capital at the end of the previous year (cost of companies not yet exited or written off).
 *
 * @param netInvestedByYear NIC at the end of each year (index = year). Missing years are treated as 0.
 * @returns fee per year (positive numbers), length = fundLifeYears. All zeros when fees are disabled.
 */
export function feeSchedule(fund: Pick<FundTerms, 'committedCapital' | 'investmentPeriodYears' | 'fundLifeYears'> & { fees: FeeTerms }, netInvestedByYear: number[]): number[] {
  const out: number[] = new Array(Math.max(0, fund.fundLifeYears)).fill(0);
  if (!fund.fees.enabled) return out;
  for (let t = 0; t < out.length; t++) {
    if (t < fund.investmentPeriodYears) {
      out[t] = fund.fees.investmentPeriodRate * fund.committedCapital;
    } else if (fund.fees.postPeriodBasis === 'commitments') {
      out[t] = fund.fees.postPeriodRate * fund.committedCapital;
    } else {
      const nic = t - 1 >= 0 ? netInvestedByYear[t - 1] ?? 0 : 0;
      out[t] = fund.fees.postPeriodRate * Math.max(0, nic);
    }
  }
  return out;
}
