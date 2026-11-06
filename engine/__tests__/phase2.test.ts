import { describe, expect, it } from 'vitest';
import { comparePolicies } from '../policy';
import { provenanceFor, resolveScenario } from '../scenario';
import { deriveMarketCase } from '../marketCase';
import * as P from '../preset';

describe('policy comparison', () => {
  const { model } = resolveScenario(P.brightPixelStrategy, P.brightPixelBaseCase);
  const seed = model.cohorts[0];
  const out = comparePolicies(seed, 10);
  it('returns none / pro rata / fixed with current marked', () => {
    expect(out.map((o) => o.policy)).toEqual(['none', 'pro_rata', 'fixed']);
    expect(out.find((o) => o.isCurrent)?.policy).toBe('pro_rata');
  });
  it('none deploys no follow-on; pro rata holds ownership through reached rounds', () => {
    expect(out[0].followOnInvested).toBe(0);
    expect(out[1].followOnInvested).toBeGreaterThan(0);
    expect(out[1].exitOwnershipByBucket.st).toBeGreaterThan(out[0].exitOwnershipByBucket.st);
  });
});

describe('provenance lookup', () => {
  const sc = { ...P.brightPixelScenario, provenance: { 'cohorts.co-ownership.buckets.ou.probability': { kind: 'user' as const } } };
  it('prefers scenario overrides, then strategy, then the market case profile', () => {
    expect(provenanceFor(sc, P.brightPixelStrategy, P.brightPixelBaseCase, 'cohorts.co-ownership.buckets.ou.probability')?.kind).toBe('user');
    expect(provenanceFor(sc, P.brightPixelStrategy, P.brightPixelBaseCase, 'cohorts.co-ownership.entry.ticket')?.kind).toBe('demo');
    expect(provenanceFor(sc, P.brightPixelStrategy, P.brightPixelBaseCase, 'cohorts.co-ownership.buckets.st.exit')?.kind).toBe('demo');
    expect(provenanceFor(sc, P.brightPixelStrategy, P.brightPixelBaseCase, 'cohorts.co-ownership.nonexistent')).toBeUndefined();
  });
});

describe('deriveMarketCase', () => {
  it('reports infeasible write-off moves without changing the bucket', () => {
    const { marketCase, issues } = deriveMarketCase(P.brightPixelBaseCase, { id: 'x', name: 'x', kind: 'custom', adjustments: { seed: { writeOffRate: 0.99 } } });
    expect(issues[0].code).toBe('residual_negative');
    expect(marketCase.profiles[0].buckets[0].probability).toBe(0.5);
  });
  it('does not mutate the base case', () => {
    const snap = JSON.stringify(P.brightPixelBaseCase);
    deriveMarketCase(P.brightPixelBaseCase, { id: 'x', name: 'x', kind: 'downside', adjustments: { seed: { exitValueMultiplier: 0.5, dilutionMultiplier: 1.3, timeToExitShift: 2 } } });
    expect(JSON.stringify(P.brightPixelBaseCase)).toBe(snap);
  });
});
