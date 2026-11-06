import type { CohortModel, FundModel, FundTerms, OutcomeBucket } from '../types';

export const noFeeFund = (over: Partial<FundTerms> = {}): FundTerms => ({
  id: 'f',
  name: 'Test fund',
  currency: 'EUR',
  committedCapital: 100,
  investmentPeriodYears: 5,
  fundLifeYears: 10,
  fees: { enabled: false, investmentPeriodRate: 0.02, postPeriodRate: 0.015, postPeriodBasis: 'net_invested' },
  carry: { enabled: false, convention: 'european', carryRate: 0.2, hurdleRate: 0.08, catchUpRate: 1 },
  reserve: { mode: 'amount', value: 0 },
  sleeves: [],
  ...over,
});

export const bucket = (id: string, kind: OutcomeBucket['kind'], probability: number, yearsToExit: number, equityValue: number, roundsReached = 0, cumulativeDilution = 0): OutcomeBucket => ({
  id,
  label: id,
  kind,
  probability,
  yearsToExit,
  exit: { mode: 'equity', equityValue },
  roundsReached,
  cumulativeDilution,
});

/** Example A: 10 companies, €2M at €8M post (25%), 50% cumulative dilution, no follow-ons, no fees. */
export const exampleACohort: CohortModel = {
  id: 'A',
  label: 'Example A',
  stage: 'seed',
  companyCount: 10,
  deployment: { mode: 'single', entryYear: 0 },
  entry: { ticket: 2, postMoney: 8, ownership: 0, derived: 'ownership' },
  followOn: { kind: 'none' },
  dilutionMode: 'quick',
  rounds: [],
  buckets: [bucket('wo', 'writeoff', 0.6, 3, 0, 0, 0.5), bucket('mo', 'modest', 0.3, 5, 40, 0, 0.5), bucket('ou', 'outlier', 0.1, 8, 400, 0, 0.5)],
};

export const exampleA: FundModel = { fund: noFeeFund(), cohorts: [exampleACohort] };
