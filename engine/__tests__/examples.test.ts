import { describe, expect, it } from 'vitest';
import { evaluateFund } from '../fund';
import { ownershipPath, evaluateCohort } from '../cohort';
import type { CohortModel } from '../types';
import { exampleA, exampleACohort, bucket } from './fixtures';

describe('Example A — quick dilution (hand-verifiable)', () => {
  const r = evaluateFund(exampleA);

  it('derives 25% entry and 12.5% exit ownership', () => {
    const c = r.cohorts[0];
    expect(c.entryOwnership).toBeCloseTo(0.25, 12);
    for (const b of c.buckets) expect(b.exitOwnership).toBeCloseTo(0.125, 12);
  });

  it('places €15M in year 5 and €50M in year 8, total €65M', () => {
    expect(r.annual[5].grossProceeds).toBeCloseTo(15, 10);
    expect(r.annual[8].grossProceeds).toBeCloseTo(50, 10);
    expect(r.gross.proceeds).toBeCloseTo(65, 10);
    expect(r.annual[0].initialInvestment).toBeCloseTo(20, 10);
  });

  it('gross MOIC 3.25×, outlier share ≈ 76.9%', () => {
    expect(r.gross.moic).toBeCloseTo(3.25, 10);
    expect(r.outlierShare).toBeCloseTo(50 / 65, 10);
    expect(+(r.outlierShare! * 100).toFixed(1)).toBe(76.9);
  });

  it('gross IRR ≈ 17.9% on −20 / +15 (y5) / +50 (y8)', () => {
    expect(r.gross.irr.ok).toBe(true);
    if (r.gross.irr.ok) expect(+(r.gross.irr.value * 100).toFixed(1)).toBe(17.9);
  });

  it('is labelled expected cash-flow case; net is N/A without fees and carry', () => {
    expect(r.label).toBe('expected cash-flow case');
    expect(r.net.available).toBe(false);
    expect(r.net.reason).toBe('N/A — enable fees and carry');
    expect(r.timeToFirstDistribution).toBe(5);
  });

  it('is deterministic and does not mutate input', () => {
    const snapshot = JSON.stringify(exampleA);
    const a = evaluateFund(exampleA);
    const b = evaluateFund(exampleA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(exampleA)).toBe(snapshot);
  });
});

describe('Example B — pro rata', () => {
  const cohort = { dilutionMode: 'explicit' as const, rounds: [{ id: 'r1', label: 'Next round', yearFromEntry: 2, size: 12, postMoney: 40 }] };
  const bk = { roundsReached: 1, cumulativeDilution: 0, yearsToExit: 5 };

  it('without follow-on: 30% round dilution → 17.5%', () => {
    const p = ownershipPath(0.25, cohort, bk, { kind: 'none' });
    expect(p.steps[0].dilution).toBeCloseTo(0.3, 12);
    expect(p.exitOwnership).toBeCloseTo(0.175, 12);
    expect(p.followOnTotal).toBe(0);
  });

  it('with pro rata: invest €3M, ownership stays 25%', () => {
    const p = ownershipPath(0.25, cohort, bk, { kind: 'pro_rata' });
    expect(p.followOnTotal).toBeCloseTo(3, 12);
    expect(p.exitOwnership).toBeCloseTo(0.25, 12);
  });

  it('pro rata through evaluateCohort places €3M per company in the round year', () => {
    const c: CohortModel = {
      ...exampleACohort,
      id: 'B',
      companyCount: 1,
      entry: { ticket: 10, postMoney: 40, ownership: 0, derived: 'ownership' },
      followOn: { kind: 'pro_rata' },
      dilutionMode: 'explicit',
      rounds: cohort.rounds,
      buckets: [bucket('st', 'strong', 1, 5, 100, 1, 0)],
    };
    const ev = evaluateCohort(c, 10);
    expect(ev.result.followOnInvested).toBeCloseTo(3, 12);
    expect(ev.result.followOnByYear[2]).toBeCloseTo(3, 12);
    expect(ev.result.proceeds).toBeCloseTo(25, 12);
  });
});
