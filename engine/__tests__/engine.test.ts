import { describe, expect, it } from 'vitest';
import { checkEntryConsistency, resolveEntry, setEntryField } from '../entry';
import { evaluateCohort, exitEquityValue } from '../cohort';
import { evaluateFund } from '../fund';
import { feeSchedule } from '../fees';
import { irr, irrLabel } from '../irr';
import { europeanWaterfall } from '../waterfall';
import { renormaliseInto, setRateWithResidual, probabilitySum } from '../probabilities';
import { perturb, sensitivityGrid } from '../sensitivity';
import type { CarryTerms, CohortModel, FundModel } from '../types';
import { bucket, exampleA, exampleACohort, noFeeFund } from './fixtures';

describe('entry: ownership = ticket / post-money', () => {
  it('derives ownership', () => {
    expect(resolveEntry({ ticket: 2, postMoney: 8, ownership: 0, derived: 'ownership' }).ownership).toBeCloseTo(0.25);
  });
  it('derives post-money', () => {
    expect(resolveEntry({ ticket: 3, postMoney: 0, ownership: 0.2, derived: 'postMoney' }).postMoney).toBeCloseTo(15);
  });
  it('derives ticket', () => {
    expect(resolveEntry({ ticket: 0, postMoney: 12, ownership: 0.25, derived: 'ticket' }).ticket).toBeCloseTo(3);
  });
  it('editing an input keeps the derived field derived', () => {
    const e = setEntryField({ ticket: 2, postMoney: 8, ownership: 0.25, derived: 'ownership' }, 'ticket', 4);
    expect(e.ownership).toBeCloseTo(0.5);
    expect(e.derived).toBe('ownership');
  });
  it('editing the derived field moves the derived role', () => {
    const e = setEntryField({ ticket: 2, postMoney: 8, ownership: 0.25, derived: 'ownership' }, 'ownership', 0.2);
    expect(e.derived).toBe('postMoney');
    expect(e.postMoney).toBeCloseTo(10);
  });
  it('flags imported values disagreeing by more than 1pp only', () => {
    expect(checkEntryConsistency(2, 8, 0.245)).toBeNull(); // 0.5pp
    expect(checkEntryConsistency(2, 8, 0.23)?.code).toBe('entry_inconsistent'); // 2pp
  });
});

describe('exit equity value', () => {
  it('revenue × multiple − net debt', () => {
    expect(exitEquityValue({ mode: 'revenue', revenue: 20, multiple: 5, netDebt: 10 })).toEqual({ equity: 90, enterprise: 100 });
    expect(exitEquityValue({ mode: 'revenue', revenue: 20, multiple: 5, netDebt: -10 }).equity).toBe(110);
  });
});

const proRataCohort = (): CohortModel => ({
  id: 'p',
  label: 'Pro rata',
  stage: 'seed',
  companyCount: 10,
  deployment: { mode: 'single', entryYear: 0 },
  entry: { ticket: 2, postMoney: 10, ownership: 0.2, derived: 'ownership' },
  followOn: { kind: 'pro_rata' },
  dilutionMode: 'explicit',
  rounds: [
    { id: 'a', label: 'A', yearFromEntry: 1, size: 10, postMoney: 40 },
    { id: 'b', label: 'B', yearFromEntry: 3, size: 20, postMoney: 100 },
  ],
  buckets: [bucket('wo', 'writeoff', 0.5, 2, 0, 0), bucket('mo', 'modest', 0.3, 5, 50, 1), bucket('st', 'strong', 0.2, 6, 300, 2)],
});

describe('outcome-dependent follow-on cost', () => {
  it('only deploys pro rata into rounds a bucket reaches', () => {
    const ev = evaluateCohort(proRataCohort(), 10);
    const byId = Object.fromEntries(ev.result.buckets.map((b) => [b.bucketId, b]));
    expect(byId.wo.followOnInvested).toBe(0);
    expect(byId.mo.followOnPerCompany).toBeCloseTo(2); // 20% × 10
    expect(byId.st.followOnPerCompany).toBeCloseTo(6); // 2 + 20% × 20
    expect(ev.result.followOnInvested).toBeCloseTo(10 * (0.3 * 2 + 0.2 * 6));
    expect(ev.result.followOnByYear[1]).toBeCloseTo(10 * 0.5 * 2);
    expect(ev.result.followOnByYear[3]).toBeCloseTo(10 * 0.2 * 4);
    expect(ev.result.maxCompanyExposure).toBeCloseTo(8);
  });
  it('raises cost when write-offs reach a round', () => {
    const c = proRataCohort();
    c.buckets[0].roundsReached = 1;
    expect(evaluateCohort(c, 10).result.followOnInvested).toBeCloseTo(18 + 10);
  });
  it('fixed ticket goes only to selected buckets, with coverage = fraction / eligible probability', () => {
    const c: CohortModel = {
      ...proRataCohort(),
      followOn: { kind: 'fixed', ticket: 1, fractionOfCohort: 0.1, bucketIds: ['st'], roundIndex: 0 },
    };
    const ev = evaluateCohort(c, 10);
    const st = ev.result.buckets.find((b) => b.bucketId === 'st')!;
    expect(st.recipientShare).toBeCloseTo(0.5);
    expect(st.exitOwnershipRecipient).toBeCloseTo(0.2 * 0.75 * 0.8 + (1 / 40) * 0.8); // diluted by B
    expect(st.exitOwnership).toBeCloseTo(0.2 * 0.75 * 0.8);
    expect(ev.result.followOnInvested).toBeCloseTo(10 * 0.2 * 0.5 * 1);
    expect(ev.issues.find((i) => i.code === 'fixed_coverage')).toBeUndefined();
  });
  it('warns when the fixed fraction exceeds eligible buckets', () => {
    const c: CohortModel = { ...proRataCohort(), followOn: { kind: 'fixed', ticket: 1, fractionOfCohort: 0.4, bucketIds: ['st'], roundIndex: 0 } };
    expect(evaluateCohort(c, 10).issues.some((i) => i.code === 'fixed_coverage')).toBe(true);
  });
  it('quick mode pro rata offsets only modelled-round dilution', () => {
    const c: CohortModel = {
      ...proRataCohort(),
      dilutionMode: 'quick',
      rounds: [{ id: 'a', label: 'A', yearFromEntry: 1, size: 10, postMoney: 40 }],
      buckets: [bucket('st', 'strong', 1, 5, 100, 1, 0.4)],
    };
    const st = evaluateCohort(c, 10).result.buckets[0];
    // residual = 0.6 / 0.75 = 0.8 → 0.2 × 0.8
    expect(st.exitOwnership).toBeCloseTo(0.16);
    c.followOn = { kind: 'none' };
    expect(evaluateCohort(c, 10).result.buckets[0].exitOwnership).toBeCloseTo(0.12);
  });
});

describe('fee schedule and step-down', () => {
  const fund = { committedCapital: 100, investmentPeriodYears: 2, fundLifeYears: 4, fees: { enabled: true, investmentPeriodRate: 0.02, postPeriodRate: 0.015, postPeriodBasis: 'net_invested' as const } };
  it('charges % of commitments in the investment period and % of prior-year NIC afterwards', () => {
    expect(feeSchedule(fund, [10, 10, 8, 0])).toEqual([2, 2, 0.15, 0.12]);
  });
  it('commitment basis after the period', () => {
    expect(feeSchedule({ ...fund, fees: { ...fund.fees, postPeriodBasis: 'commitments' } }, [])).toEqual([2, 2, 1.5, 1.5]);
  });
  it('is zero when disabled', () => {
    expect(feeSchedule({ ...fund, fees: { ...fund.fees, enabled: false } }, [10])).toEqual([0, 0, 0, 0]);
  });
  it('flows into paid-in and investable capital, NIC drops on write-off', () => {
    const model: FundModel = {
      fund: noFeeFund({ investmentPeriodYears: 2, fundLifeYears: 4, fees: fund.fees }),
      cohorts: [{ ...exampleACohort, companyCount: 1, entry: { ticket: 10, postMoney: 40, ownership: 0, derived: 'ownership' }, buckets: [bucket('wo', 'writeoff', 1, 2, 0)] }],
    };
    const r = evaluateFund(model);
    expect(r.annual.map((a) => a.netInvestedCapital).slice(0, 3)).toEqual([10, 10, 0]);
    expect(r.capital.totalFees).toBeCloseTo(2 + 2 + 0.15 + 0);
    expect(r.capital.investable).toBeCloseTo(100 - 4.15);
    expect(r.capital.paidIn).toBeCloseTo(14.15);
    expect(r.capital.invested).toBeCloseTo(10);
  });
});

describe('European waterfall', () => {
  const carry: CarryTerms = { enabled: true, convention: 'european', carryRate: 0.2, hurdleRate: 0.08, catchUpRate: 1 };
  const run = (d: number) => europeanWaterfall([100, 0], [0, d], carry);
  it('below the hurdle: everything to LPs', () => {
    const w = run(105);
    expect(w.totals.gpCarry).toBe(0);
    expect(w.totals.lpDistributions).toBeCloseTo(105);
    expect(w.totals.returnOfCapital).toBeCloseTo(100);
    expect(w.totals.preferredReturn).toBeCloseTo(5);
  });
  it('in catch-up: GP receives 100% above the 108 hurdle', () => {
    const w = run(109);
    expect(w.totals.lpDistributions).toBeCloseTo(108);
    expect(w.totals.gpCarry).toBeCloseTo(1);
    expect(w.totals.catchUp).toBeCloseTo(1);
  });
  it('fully past catch-up: GP holds exactly 20% of profit', () => {
    const w = run(200);
    expect(w.totals.gpCarry).toBeCloseTo(20);
    expect(w.totals.lpDistributions).toBeCloseTo(180);
    expect(w.totals.catchUp).toBeCloseTo(2);
    expect(w.totals.splitToGp).toBeCloseTo(18);
  });
  it('compounds the pref over multiple years', () => {
    const w = europeanWaterfall([100, 0, 0], [0, 0, 116.64], carry); // 100 × 1.08²
    expect(w.totals.gpCarry).toBeCloseTo(0, 9);
    expect(europeanWaterfall([100, 0, 0], [0, 0, 120], carry).totals.gpCarry).toBeCloseTo(3.36);
  });
  it('fund-level net result conserves cash: LP + GP = gross proceeds', () => {
    const r = evaluateFund({ ...exampleA, fund: noFeeFund({ fees: { enabled: true, investmentPeriodRate: 0.02, postPeriodRate: 0.015, postPeriodBasis: 'net_invested' }, carry }) });
    expect(r.net.available).toBe(true);
    const w = r.net.waterfall!;
    expect(w.lpDistributions + w.gpCarry).toBeCloseTo(r.gross.proceeds);
    expect(r.net.netMultiple!).toBeLessThan(r.gross.moic!);
    expect(r.net.netIrr.ok).toBe(true);
    expect(r.net.convention).toContain('European');
  });
});

describe('capital allocation limits', () => {
  it('errors when investments exceed investable capital', () => {
    const r = evaluateFund({ ...exampleA, cohorts: [{ ...exampleACohort, companyCount: 60 }] });
    expect(r.issues.find((i) => i.code === 'over_investable')?.severity).toBe('error');
    expect(r.capital.unusedCapacity).toBeCloseTo(100 - 120);
  });
  it('warns (does not block) on reserve over-allocation and flags the year', () => {
    const r = evaluateFund({ fund: noFeeFund({ reserve: { mode: 'amount', value: 10 } }), cohorts: [proRataCohort()] });
    expect(r.capital.followOnInvested).toBeCloseTo(18);
    expect(r.capital.reserveOverAllocation).toBeCloseTo(8);
    expect(r.capital.reserveUnused).toBe(0);
    expect(r.issues.find((i) => i.code === 'reserve_over_allocated')?.severity).toBe('warning');
    expect(r.annual[1].reserveOverAllocated).toBe(false); // 10 used in y1
    expect(r.annual[3].reserveOverAllocated).toBe(true);
    expect(r.gross.moic).not.toBeNull();
  });
  it('reports unused reserve and initial budget overrun', () => {
    const r = evaluateFund({ fund: noFeeFund({ reserve: { mode: 'percent', value: 0.85 } }), cohorts: [proRataCohort()] });
    expect(r.capital.reserve).toBeCloseTo(85);
    expect(r.capital.reserveUnused).toBeCloseTo(67);
    expect(r.capital.initialOverAllocation).toBeCloseTo(5); // 20 initial vs 15 budget
  });
  it('separate-use sleeves reduce direct investable capital; sleeve gap reported', () => {
    const fund = noFeeFund({
      fees: { enabled: true, investmentPeriodRate: 0.02, postPeriodRate: 0.02, postPeriodBasis: 'commitments' },
      sleeves: [{ id: 'a', label: 'A', amount: 90, use: 'direct' }, { id: 'e', label: 'E', amount: 10, use: 'separate' }],
    });
    const r = evaluateFund({ fund, cohorts: [{ ...exampleACohort, sleeveId: 'a' }] });
    expect(r.capital.investable).toBeCloseTo(80);
    expect(r.capital.directInvestable).toBeCloseTo(70);
    expect(r.capital.sleeveGap).toBeCloseTo(20);
    expect(r.capital.sleeveUsage[0].invested).toBeCloseTo(20);
  });
});

describe('validation', () => {
  it('blocks probabilities not summing to 100%', () => {
    const c = { ...exampleACohort, buckets: exampleACohort.buckets.map((b, i) => (i === 0 ? { ...b, probability: 0.5 } : b)) };
    expect(evaluateFund({ ...exampleA, cohorts: [c] }).issues.find((i) => i.code === 'probability_sum')?.severity).toBe('error');
  });
  it('warns on exits beyond fund life and still counts proceeds', () => {
    const c = { ...exampleACohort, buckets: exampleACohort.buckets.map((b) => (b.id === 'ou' ? { ...b, yearsToExit: 12 } : b)) };
    const r = evaluateFund({ ...exampleA, cohorts: [c] });
    expect(r.issues.some((i) => i.code === 'exit_beyond_life')).toBe(true);
    expect(r.gross.proceeds).toBeCloseTo(65);
    expect(r.annual.length).toBe(13);
  });
  it('flags ownership outside (0,1)', () => {
    const c = { ...exampleACohort, entry: { ticket: 10, postMoney: 8, ownership: 0, derived: 'ownership' as const } };
    expect(evaluateFund({ ...exampleA, cohorts: [c] }).issues.some((i) => i.code === 'ownership_range')).toBe(true);
  });
});

describe('probabilities', () => {
  const bs = [bucket('wo', 'writeoff', 0.5, 1, 0), bucket('mo', 'modest', 0.3, 1, 1), bucket('st', 'strong', 0.1, 1, 1)];
  it('renormalises the residual into a chosen bucket', () => {
    const r = renormaliseInto(bs, 'mo')!;
    expect(probabilitySum(r)).toBeCloseTo(1);
    expect(r[1].probability).toBeCloseTo(0.4);
  });
  it('moves a rate with residual absorption, refusing negatives', () => {
    const ok = renormaliseInto(bs, 'mo')!;
    expect(setRateWithResidual(ok, 'wo', 0.6, 'mo')![1].probability).toBeCloseTo(0.3);
    expect(setRateWithResidual(ok, 'wo', 0.95, 'mo')).toBeNull();
  });
});

describe('IRR', () => {
  it('N/A with no sign change', () => {
    expect(irr([10, 5])).toEqual({ ok: false, reason: 'no_sign_change' });
    expect(irr([-10, -5])).toEqual({ ok: false, reason: 'no_sign_change' });
    expect(irrLabel(irr([-10, 0]))).toContain('N/A');
  });
  it('N/A with multiple roots', () => {
    expect(irr([-1, 6, -11, 6])).toEqual({ ok: false, reason: 'multiple_roots' });
    expect(irr([-10, 20, -1])).toEqual({ ok: false, reason: 'multiple_roots' }); // roots ≈ 94.9% and −94.9%
  });
  it('solves simple cases', () => {
    const r = irr([-100, 110]);
    expect(r.ok && r.value).toBeCloseTo(0.1, 9);
    const neg = irr([-100, 50]);
    expect(neg.ok && neg.value).toBeCloseTo(-0.5, 9);
  });
  it('accepts multi-sign-change flows with a unique root', () => {
    const r = irr([-20, -5, 3, -5, 40]); // follow-on after an early exit
    expect(r.ok).toBe(true);
  });
  it('N/A for empty flows', () => {
    expect(irr([]).ok).toBe(false);
  });
});

describe('sensitivity', () => {
  it('exit value multiplier scales proceeds linearly', () => {
    expect(evaluateFund(perturb(exampleA, 'exitValueMultiplier', 2)).gross.moic).toBeCloseTo(6.5);
  });
  it('time shift moves proceeds without changing MOIC', () => {
    const r = evaluateFund(perturb(exampleA, 'timeToExitShift', 1));
    expect(r.gross.moic).toBeCloseTo(3.25);
    expect(r.annual[6].grossProceeds).toBeCloseTo(15);
  });
  it('write-off shift moves probability into/out of the residual bucket', () => {
    const m = perturb(exampleA, 'writeOffRateShift', 0.1);
    expect(m.cohorts[0].buckets.map((b) => +b.probability.toFixed(6))).toEqual([0.7, 0.2, 0.1]);
  });
  it('builds a 7×7 grid with the base case at the centre', () => {
    const g = sensitivityGrid(exampleA, { variable: 'exitValueMultiplier' }, { variable: 'timeToExitShift' }, 'grossMoic');
    expect(g.cells.length).toBe(7);
    expect(g.cells[0].length).toBe(7);
    expect(g.cells[3][3]).toBeCloseTo(3.25);
  });
});
