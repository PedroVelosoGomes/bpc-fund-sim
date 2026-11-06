/**
 * Scenario composition: scenario = (strategy, market case).
 *
 * - A Strategy is portfolio construction: fund terms + cohorts (counts, tickets, ownership, deployment, follow-on policy).
 * - A MarketCase is market assumptions: per-profile outcome buckets, round schedule, dilution.
 * - Cohorts reference a market profile by id; if the case lacks that id, the profile is matched by stage, then geography.
 * - Per-cohort overrides on a Scenario let the user edit outcomes for one cohort without touching the shared case.
 */
import type {
  CohortModel,
  DeploymentProfile,
  EntryTerms,
  FollowOnPolicy,
  FundModel,
  FundTerms,
  Issue,
  OutcomeBucket,
  ProvenanceMap,
  RoundSpec,
} from './types';

export interface CohortStrategy {
  id: string;
  label: string;
  stage: string;
  geography?: string;
  sleeveId?: string;
  strategyTag?: string;
  companyCount: number;
  deployment: DeploymentProfile;
  entry: EntryTerms;
  followOn: FollowOnPolicy;
  marketProfileId: string;
}

export interface MarketProfile {
  id: string;
  label: string;
  stage: string;
  geography?: string;
  dilutionMode: 'quick' | 'explicit';
  rounds: RoundSpec[];
  buckets: OutcomeBucket[];
  residualBucketId?: string;
  /** Acceptable entry post-money range for this stage (used by strategy search feasibility). */
  entryPostMoneyRange?: { low: number; high: number };
}

export type MarketCaseKind = 'downside' | 'base' | 'upside' | 'custom';

export interface MarketCase {
  id: string;
  name: string;
  kind: MarketCaseKind;
  profiles: MarketProfile[];
  /** True only when the source benchmark explicitly supports a percentile reading. Default false: assumption bundle. */
  percentileBacked: boolean;
  note?: string;
}

export interface Strategy {
  id: string;
  name: string;
  fund: FundTerms;
  cohorts: CohortStrategy[];
}

export type CohortMarketOverride = Partial<Pick<MarketProfile, 'dilutionMode' | 'rounds' | 'buckets' | 'residualBucketId'>>;

export interface Scenario {
  id: string;
  name: string;
  strategyId: string;
  marketCaseId: string;
  cohortOverrides: Record<string, CohortMarketOverride>;
  provenance: ProvenanceMap;
  parentId?: string;
  origin?: 'demo' | 'generated' | 'clone' | 'proposal' | 'user';
  createdAt?: string;
  notes?: string;
}

export function findProfile(mc: MarketCase, cohort: Pick<CohortStrategy, 'marketProfileId' | 'stage' | 'geography'>): { profile?: MarketProfile; how: 'id' | 'stage+geography' | 'stage' | 'none' } {
  const byId = mc.profiles.find((p) => p.id === cohort.marketProfileId);
  if (byId) return { profile: byId, how: 'id' };
  const sg = mc.profiles.find((p) => p.stage === cohort.stage && (p.geography ?? '') === (cohort.geography ?? ''));
  if (sg) return { profile: sg, how: 'stage+geography' };
  const s = mc.profiles.find((p) => p.stage === cohort.stage);
  if (s) return { profile: s, how: 'stage' };
  return { how: 'none' };
}

/** Build the flat FundModel the engine evaluates. Never mutates its inputs. */
export function resolveScenario(strategy: Strategy, marketCase: MarketCase, overrides: Record<string, CohortMarketOverride> = {}): { model: FundModel; issues: Issue[] } {
  const issues: Issue[] = [];
  const cohorts: CohortModel[] = [];
  for (const c of strategy.cohorts) {
    const { profile, how } = findProfile(marketCase, c);
    if (!profile) {
      issues.push({ severity: 'error', code: 'no_market_profile', message: `${c.label}: market case "${marketCase.name}" has no profile for stage ${c.stage}.`, path: `cohorts.${c.id}` });
      continue;
    }
    if (how !== 'id') issues.push({ severity: 'info', code: 'profile_fallback', message: `${c.label}: matched market profile "${profile.label}" by ${how}.`, path: `cohorts.${c.id}` });
    const o = overrides[c.id] ?? {};
    cohorts.push({
      id: c.id,
      label: c.label,
      stage: c.stage,
      geography: c.geography,
      sleeveId: c.sleeveId,
      strategyTag: c.strategyTag,
      companyCount: c.companyCount,
      deployment: c.deployment,
      entry: c.entry,
      followOn: c.followOn,
      dilutionMode: o.dilutionMode ?? profile.dilutionMode,
      rounds: o.rounds ?? profile.rounds,
      buckets: o.buckets ?? profile.buckets,
      residualBucketId: o.residualBucketId ?? profile.residualBucketId,
    });
  }
  return { model: { fund: strategy.fund, cohorts }, issues };
}
