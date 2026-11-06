/** Zod schemas mirroring the public types. Used for import validation and persisted-state checks. */
import { z } from 'zod';

const num = z.number().finite();
const nonNeg = num.min(0);
const prob = num.min(0).max(1);

export const provenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('benchmark'), source: z.string(), asOf: z.string(), unit: z.string(), benchmarkId: z.string().optional(), note: z.string().optional() }),
  z.object({ kind: z.literal('demo'), note: z.string().optional() }),
  z.object({ kind: z.literal('user'), at: z.string().optional(), previous: z.any().optional() }),
]);

export const fundTermsSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string().length(3),
  committedCapital: num.positive(),
  investmentPeriodYears: z.number().int().min(0),
  fundLifeYears: z.number().int().min(1),
  fees: z.object({ enabled: z.boolean(), investmentPeriodRate: prob, postPeriodRate: prob, postPeriodBasis: z.enum(['net_invested', 'commitments']) }),
  carry: z.object({ enabled: z.boolean(), convention: z.literal('european'), carryRate: prob, hurdleRate: num.min(0), catchUpRate: prob }),
  reserve: z.object({ mode: z.enum(['amount', 'percent']), value: nonNeg }),
  sleeves: z.array(z.object({ id: z.string(), label: z.string(), amount: nonNeg, use: z.enum(['direct', 'separate']) })),
});

export const roundSchema = z.object({ id: z.string(), label: z.string(), yearFromEntry: z.number().int().min(0), size: num.positive(), postMoney: num.positive() });

export const exitSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equity'), equityValue: nonNeg }),
  z.object({ mode: z.literal('revenue'), revenue: nonNeg, multiple: nonNeg, netDebt: num }),
]);

export const bucketSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['writeoff', 'modest', 'strong', 'outlier', 'other']),
  probability: prob,
  yearsToExit: z.number().int().min(0),
  exit: exitSchema,
  roundsReached: z.number().int().min(0),
  cumulativeDilution: num.min(0).max(0.999),
});

export const entrySchema = z.object({ ticket: nonNeg, postMoney: nonNeg, ownership: prob, derived: z.enum(['ticket', 'postMoney', 'ownership']) });

export const followOnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('pro_rata') }),
  z.object({ kind: z.literal('fixed'), ticket: nonNeg, fractionOfCohort: prob, bucketIds: z.array(z.string()), roundIndex: z.number().int().min(0) }),
]);

export const deploymentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('single'), entryYear: z.number().int().min(0) }),
  z.object({ mode: z.literal('spread'), weights: z.array(prob).min(1) }),
]);

export const cohortSchema = z.object({
  id: z.string(),
  label: z.string(),
  stage: z.string(),
  geography: z.string().optional(),
  sleeveId: z.string().optional(),
  strategyTag: z.string().optional(),
  companyCount: nonNeg,
  deployment: deploymentSchema,
  entry: entrySchema,
  followOn: followOnSchema,
  dilutionMode: z.enum(['quick', 'explicit']),
  rounds: z.array(roundSchema),
  buckets: z.array(bucketSchema).min(1),
  residualBucketId: z.string().optional(),
});

export const fundModelSchema = z.object({ fund: fundTermsSchema, cohorts: z.array(cohortSchema) });

export const marketProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  stage: z.string(),
  geography: z.string().optional(),
  dilutionMode: z.enum(['quick', 'explicit']),
  rounds: z.array(roundSchema),
  buckets: z.array(bucketSchema).min(1),
  residualBucketId: z.string().optional(),
  entryPostMoneyRange: z.object({ low: nonNeg, high: nonNeg }).optional(),
});

export const marketCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['downside', 'base', 'upside', 'custom']),
  profiles: z.array(marketProfileSchema),
  percentileBacked: z.boolean(),
  note: z.string().optional(),
});

export const cohortStrategySchema = cohortSchema
  .omit({ dilutionMode: true, rounds: true, buckets: true, residualBucketId: true })
  .extend({ marketProfileId: z.string() });

export const strategySchema = z.object({ id: z.string(), name: z.string(), fund: fundTermsSchema, cohorts: z.array(cohortStrategySchema) });

export const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string(),
  marketCaseId: z.string(),
  cohortOverrides: z.record(
    z.object({ dilutionMode: z.enum(['quick', 'explicit']).optional(), rounds: z.array(roundSchema).optional(), buckets: z.array(bucketSchema).optional(), residualBucketId: z.string().optional() }),
  ),
  provenance: z.record(provenanceSchema),
  parentId: z.string().optional(),
  origin: z.enum(['demo', 'generated', 'clone', 'proposal', 'user']).optional(),
  createdAt: z.string().optional(),
  notes: z.string().optional(),
});
