import { evaluateCohort } from './cohort';
import type { CohortModel, FollowOnPolicy } from './types';

export interface PolicyOutcome {
  policy: FollowOnPolicy['kind'];
  label: string;
  isCurrent: boolean;
  initialInvested: number;
  followOnInvested: number;
  proceeds: number;
  grossMoic: number | null;
  maxCompanyExposure: number;
  /** Exit ownership per bucket (blended across recipients / non-recipients by share). */
  exitOwnershipByBucket: Record<string, number>;
  available: boolean;
  reason?: string;
}

/**
 * Cash and ownership consequences of each follow-on policy for one cohort, holding everything else fixed.
 * For 'fixed', uses the cohort's own fixed settings when present, otherwise `defaultFixed`.
 */
export function comparePolicies(
  cohort: CohortModel,
  fundLifeYears: number,
  defaultFixed: Extract<FollowOnPolicy, { kind: 'fixed' }> = {
    kind: 'fixed',
    ticket: cohort.entry.ticket,
    fractionOfCohort: 0.2,
    bucketIds: cohort.buckets.filter((b) => b.kind === 'strong' || b.kind === 'outlier').map((b) => b.id),
    roundIndex: 0,
  },
): PolicyOutcome[] {
  const policies: { p: FollowOnPolicy; label: string }[] = [
    { p: { kind: 'none' }, label: 'None' },
    { p: { kind: 'pro_rata' }, label: 'Pro rata' },
    { p: cohort.followOn.kind === 'fixed' ? cohort.followOn : defaultFixed, label: 'Fixed ticket' },
  ];
  return policies.map(({ p, label }) => {
    const available = p.kind === 'none' || cohort.rounds.length > 0;
    const ev = evaluateCohort({ ...cohort, followOn: p }, fundLifeYears).result;
    const exitOwnershipByBucket: Record<string, number> = {};
    for (const b of ev.buckets) exitOwnershipByBucket[b.bucketId] = b.exitOwnership * (1 - b.recipientShare) + (b.exitOwnershipRecipient ?? 0) * b.recipientShare;
    return {
      policy: p.kind,
      label: p.kind === 'fixed' ? `Fixed ${p.ticket.toFixed(1)}m into ${(p.fractionOfCohort * 100).toFixed(0)}%` : label,
      isCurrent: p.kind === cohort.followOn.kind,
      initialInvested: ev.initialInvested,
      followOnInvested: ev.followOnInvested,
      proceeds: ev.proceeds,
      grossMoic: ev.grossMoic,
      maxCompanyExposure: ev.maxCompanyExposure,
      exitOwnershipByBucket,
      available,
      reason: available ? undefined : 'No modelled rounds — follow-ons need a round schedule.',
    };
  });
}
