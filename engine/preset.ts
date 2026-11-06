/**
 * Bright Pixel Capital demo preset.
 * ALL valuation, dilution, exit and outcome values below are DEMO DATA — illustrative only, not benchmarks.
 */
import type { MarketCase, MarketProfile, Scenario, Strategy } from './scenario';
import type { FundTerms, OutcomeBucket, ProvenanceMap } from './types';
import { deriveMarketCase, type ProfileAdjustment } from './marketCase';

export const DEMO_LABEL = 'demo data';

export const brightPixelFund: FundTerms = {
  id: 'fund-bpc-demo',
  name: 'Bright Pixel Capital Fund (demo)',
  currency: 'EUR',
  committedCapital: 250,
  investmentPeriodYears: 5,
  fundLifeYears: 10,
  fees: { enabled: true, investmentPeriodRate: 0.02, postPeriodRate: 0.015, postPeriodBasis: 'net_invested' },
  carry: { enabled: true, convention: 'european', carryRate: 0.2, hurdleRate: 0.08, catchUpRate: 1 },
  reserve: { mode: 'percent', value: 0.35 },
  sleeves: [
    { id: 'sl-ownership', label: 'Ownership', amount: 145, use: 'direct' },
    { id: 'sl-exploration', label: 'Exploration', amount: 90, use: 'direct' },
    { id: 'sl-ecosystem', label: 'Ecosystem', amount: 15, use: 'separate' },
  ],
};

const b = (id: string, label: string, kind: OutcomeBucket['kind'], probability: number, yearsToExit: number, equityValue: number, roundsReached: number, cumulativeDilution: number): OutcomeBucket => ({
  id,
  label,
  kind,
  probability,
  yearsToExit,
  exit: { mode: 'equity', equityValue },
  roundsReached,
  cumulativeDilution,
});

/** Seed-stage profile: explicit rounds (Series A, Series B), additional ESOP dilution in cumulativeDilution. */
export const seedProfile: MarketProfile = {
  id: 'mp-seed-eu',
  label: 'Seed · Europe (demo)',
  stage: 'seed',
  geography: 'europe',
  dilutionMode: 'explicit',
  rounds: [
    { id: 'r-a', label: 'Series A', yearFromEntry: 2, size: 10, postMoney: 40 },
    { id: 'r-b', label: 'Series B', yearFromEntry: 4, size: 25, postMoney: 125 },
  ],
  buckets: [
    b('wo', 'Write-off', 'writeoff', 0.5, 3, 0, 1, 0),
    b('mo', 'Modest exit', 'modest', 0.3, 6, 60, 1, 0.1),
    b('st', 'Strong exit', 'strong', 0.15, 7, 250, 2, 0.15),
    b('ou', 'Outlier', 'outlier', 0.05, 8, 1200, 2, 0.25),
  ],
  residualBucketId: 'mo',
  entryPostMoneyRange: { low: 10, high: 22 },
};

/** Pre-seed profile: quick (cumulative) dilution, one modelled round used for the fixed follow-on. */
export const preSeedProfile: MarketProfile = {
  id: 'mp-preseed-eu',
  label: 'Pre-seed · Europe (demo)',
  stage: 'pre-seed',
  geography: 'europe',
  dilutionMode: 'quick',
  rounds: [{ id: 'r-seed', label: 'Seed', yearFromEntry: 2, size: 6, postMoney: 24 }],
  buckets: [
    b('wo', 'Write-off', 'writeoff', 0.6, 3, 0, 0, 0),
    b('mo', 'Modest exit', 'modest', 0.25, 6, 40, 1, 0.5),
    b('st', 'Strong exit', 'strong', 0.12, 7, 150, 1, 0.6),
    b('ou', 'Outlier', 'outlier', 0.03, 8, 1000, 1, 0.7),
  ],
  residualBucketId: 'mo',
  entryPostMoneyRange: { low: 6, high: 16 },
};

export const brightPixelBaseCase: MarketCase = {
  id: 'mc-demo-base',
  name: 'Base (demo)',
  kind: 'base',
  profiles: [seedProfile, preSeedProfile],
  percentileBacked: false,
  note: 'Demo data assumption bundle, not a statistical percentile.',
};

export const brightPixelStrategy: Strategy = {
  id: 'st-bpc-balanced',
  name: 'Balanced (demo)',
  fund: brightPixelFund,
  cohorts: [
    {
      id: 'co-ownership',
      label: 'Ownership — Seed',
      stage: 'seed',
      geography: 'europe',
      sleeveId: 'sl-ownership',
      strategyTag: 'Concentrated',
      companyCount: 18,
      deployment: { mode: 'spread', weights: [0.2, 0.3, 0.3, 0.2] },
      entry: { ticket: 3, postMoney: 15, ownership: 0.2, derived: 'ownership' },
      followOn: { kind: 'pro_rata' },
      marketProfileId: 'mp-seed-eu',
    },
    {
      id: 'co-exploration',
      label: 'Exploration — Pre-seed',
      stage: 'pre-seed',
      geography: 'europe',
      sleeveId: 'sl-exploration',
      strategyTag: 'Exploration',
      companyCount: 27,
      deployment: { mode: 'spread', weights: [0.25, 0.25, 0.25, 0.25] },
      entry: { ticket: 2, postMoney: 12, ownership: 2 / 12, derived: 'ownership' },
      followOn: { kind: 'fixed', ticket: 3, fractionOfCohort: 0.15, bucketIds: ['st', 'ou'], roundIndex: 0 },
      marketProfileId: 'mp-preseed-eu',
    },
  ],
};

const DEMO = { kind: 'demo' as const, note: DEMO_LABEL };

/** Strategy-side provenance: every fund and cohort input is demo data. */
export function demoStrategyProvenance(strategy: Strategy): ProvenanceMap {
  const p: ProvenanceMap = {};
  for (const k of ['committedCapital', 'investmentPeriodYears', 'fundLifeYears', 'reserve', 'fees', 'carry', 'sleeves']) p[`fund.${k}`] = DEMO;
  for (const c of strategy.cohorts)
    for (const k of ['companyCount', 'entry.ticket', 'entry.postMoney', 'entry.ownership', 'deployment', 'followOn']) p[`cohorts.${c.id}.${k}`] = DEMO;
  return p;
}

/** Market-side provenance: every round and bucket value is demo data. */
export function demoMarketProvenance(mc: MarketCase): ProvenanceMap {
  const p: ProvenanceMap = {};
  for (const prof of mc.profiles) {
    p[`profiles.${prof.id}.rounds`] = DEMO;
    for (const r of prof.rounds) p[`profiles.${prof.id}.rounds.${r.id}`] = DEMO;
    for (const bk of prof.buckets) {
      p[`profiles.${prof.id}.buckets.${bk.id}`] = DEMO;
      for (const k of ['probability', 'yearsToExit', 'exit', 'roundsReached', 'cumulativeDilution']) p[`profiles.${prof.id}.buckets.${bk.id}.${k}`] = DEMO;
    }
  }
  return p;
}

/** @deprecated kept for compatibility: union of strategy and market provenance. */
export function demoProvenance(strategy: Strategy, mc: MarketCase): ProvenanceMap {
  return { ...demoStrategyProvenance(strategy), ...demoMarketProvenance(mc) };
}

brightPixelStrategy.provenance = demoStrategyProvenance(brightPixelStrategy);
brightPixelBaseCase.provenance = demoMarketProvenance(brightPixelBaseCase);

/** A concentrated alternative: fewer, larger Ownership positions; smaller Exploration sleeve. Demo data. */
export const concentratedStrategy: Strategy = {
  id: 'st-bpc-concentrated',
  name: 'Concentrated (demo)',
  fund: brightPixelFund,
  cohorts: [
    { ...brightPixelStrategy.cohorts[0], companyCount: 18, entry: { ticket: 4, postMoney: 16, ownership: 0.25, derived: 'ownership' } },
    { ...brightPixelStrategy.cohorts[1], companyCount: 14 },
  ],
};
concentratedStrategy.provenance = demoStrategyProvenance(concentratedStrategy);

export const brightPixelScenario: Scenario = {
  id: 'sc-bpc-balanced-base',
  name: 'Balanced × Base (demo)',
  strategyId: brightPixelStrategy.id,
  marketCaseId: brightPixelBaseCase.id,
  cohortOverrides: {},
  provenance: {},
  origin: 'demo',
};

/** Demo low/base/high ranges per stage, used to seed Downside/Upside before a benchmark is imported (phase 3). */
export const demoRanges = {
  seed: { exitValueMultiplier: { low: 0.6, base: 1, high: 1.4 }, writeOffRate: { low: 0.42, base: 0.5, high: 0.6 }, timeToExitShift: { low: -1, base: 0, high: 1 }, dilutionMultiplier: { low: 0.85, base: 1, high: 1.2 } },
  'pre-seed': { exitValueMultiplier: { low: 0.6, base: 1, high: 1.4 }, writeOffRate: { low: 0.52, base: 0.6, high: 0.7 }, timeToExitShift: { low: -1, base: 0, high: 1 }, dilutionMultiplier: { low: 0.85, base: 1, high: 1.2 } },
} as const;

/** Demo Downside / Upside cases: Downside = low exits, high write-offs, high dilution, later exits; Upside mirrors. */
export function demoMarketCases(): MarketCase[] {
  const down: Record<string, ProfileAdjustment> = {};
  const up: Record<string, ProfileAdjustment> = {};
  for (const [stage, r] of Object.entries(demoRanges)) {
    down[stage] = { exitValueMultiplier: r.exitValueMultiplier.low, writeOffRate: r.writeOffRate.high, timeToExitShift: r.timeToExitShift.high, dilutionMultiplier: r.dilutionMultiplier.high };
    up[stage] = { exitValueMultiplier: r.exitValueMultiplier.high, writeOffRate: r.writeOffRate.low, timeToExitShift: r.timeToExitShift.low, dilutionMultiplier: r.dilutionMultiplier.low };
  }
  const downside = deriveMarketCase(brightPixelBaseCase, { id: 'mc-demo-downside', name: 'Downside (demo)', kind: 'downside', adjustments: down }).marketCase;
  const upside = deriveMarketCase(brightPixelBaseCase, { id: 'mc-demo-upside', name: 'Upside (demo)', kind: 'upside', adjustments: up }).marketCase;
  return [downside, brightPixelBaseCase, upside];
}
