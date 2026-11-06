import { resolveEntry } from './entry';
import { irr } from './irr';
import type {
  BucketResult,
  CashFlowLine,
  CohortModel,
  CohortResult,
  ExitValueSpec,
  Issue,
  OutcomeBucket,
  OwnershipStep,
  RoundSpec,
} from './types';

/** Equity value at exit. Revenue mode: revenue × multiple − net debt (net cash = negative net debt). Floored at 0. */
export function exitEquityValue(exit: ExitValueSpec): { equity: number; enterprise?: number } {
  if (exit.mode === 'equity') return { equity: Math.max(0, exit.equityValue) };
  const ev = exit.revenue * exit.multiple;
  return { equity: Math.max(0, ev - exit.netDebt), enterprise: ev };
}

export function roundDilution(r: Pick<RoundSpec, 'size' | 'postMoney'>): number {
  return r.postMoney > 0 ? r.size / r.postMoney : NaN;
}

/** Deployment weights by entry year: [{year, weight}]. */
export function deploymentWeights(c: Pick<CohortModel, 'deployment'>): { year: number; weight: number }[] {
  if (c.deployment.mode === 'single') return [{ year: c.deployment.entryYear, weight: 1 }];
  return c.deployment.weights.map((w, year) => ({ year, weight: w })).filter((x) => x.weight > 0);
}

export interface OwnershipPathResult {
  steps: OwnershipStep[];
  exitOwnership: number;
  /** Follow-on cash per company by round. */
  followOns: { round: RoundSpec; amount: number }[];
  followOnTotal: number;
}

/**
 * Ownership path for one company of a bucket.
 *
 * @param participate 'none' | 'pro_rata' | 'fixed' (fixed applies only if `fixedTicket` and the round index is reached)
 *
 * Quick mode:  non-participating exit ownership = entry × (1 − cumulativeDilution) exactly.
 *              Participating paths walk the modelled rounds, then apply the residual dilution not explained by those
 *              rounds: residual factor = (1 − cumulativeDilution) / Π(1 − d_i), capped at 1.
 * Explicit:    walk the reached rounds; d_i = size_i / postMoney_i; then apply (1 − cumulativeDilution) as
 *              additional unmodelled dilution (default 0).
 */
export function ownershipPath(
  entryOwnership: number,
  cohort: Pick<CohortModel, 'dilutionMode' | 'rounds'>,
  bucket: Pick<OutcomeBucket, 'roundsReached' | 'cumulativeDilution' | 'yearsToExit'>,
  participate: { kind: 'none' } | { kind: 'pro_rata' } | { kind: 'fixed'; ticket: number; roundIndex: number },
): OwnershipPathResult {
  const rounds = sortedRounds(cohort.rounds);
  const reached = rounds.slice(0, Math.max(0, Math.min(bucket.roundsReached, rounds.length)));
  const steps: OwnershipStep[] = [];
  const followOns: { round: RoundSpec; amount: number }[] = [];

  if (cohort.dilutionMode === 'quick' && participate.kind === 'none') {
    const exitOwnership = entryOwnership * (1 - bucket.cumulativeDilution);
    steps.push({
      label: 'Cumulative dilution (quick mode)',
      year: bucket.yearsToExit,
      ownershipBefore: entryOwnership,
      ownershipAfter: exitOwnership,
      invested: 0,
      dilution: bucket.cumulativeDilution,
    });
    return { steps, exitOwnership, followOns, followOnTotal: 0 };
  }

  let own = entryOwnership;
  let product = 1;
  reached.forEach((round, i) => {
    const d = roundDilution(round);
    product *= 1 - d;
    const before = own;
    let invested = 0;
    if (participate.kind === 'pro_rata') {
      invested = own * round.size;
      // own × (1 − d) + own × size / post = own
    } else if (participate.kind === 'fixed' && i === participate.roundIndex) {
      invested = participate.ticket;
      own = own * (1 - d) + participate.ticket / round.postMoney;
    } else {
      own = own * (1 - d);
    }
    if (invested > 0) followOns.push({ round, amount: invested });
    steps.push({ label: round.label, year: round.yearFromEntry, ownershipBefore: before, ownershipAfter: own, invested, dilution: d });
  });

  let residualFactor: number;
  if (cohort.dilutionMode === 'quick') {
    residualFactor = product > 0 ? Math.min(1, (1 - bucket.cumulativeDilution) / product) : 1;
  } else {
    residualFactor = 1 - bucket.cumulativeDilution;
  }
  if (Math.abs(residualFactor - 1) > 1e-12) {
    const before = own;
    own = own * residualFactor;
    steps.push({
      label: cohort.dilutionMode === 'quick' ? 'Residual dilution (not in modelled rounds)' : 'Additional dilution (ESOP / unmodelled)',
      year: bucket.yearsToExit,
      ownershipBefore: before,
      ownershipAfter: own,
      invested: 0,
      dilution: 1 - residualFactor,
    });
  }
  return { steps, exitOwnership: own, followOns, followOnTotal: followOns.reduce((a, f) => a + f.amount, 0) };
}

export function sortedRounds(rounds: RoundSpec[]): RoundSpec[] {
  return [...rounds].sort((a, b) => a.yearFromEntry - b.yearFromEntry);
}

/** Share of each bucket's companies that receive a fixed follow-on. */
export function fixedCoverage(cohort: CohortModel): { coverage: Record<string, number>; eligibleProbability: number } {
  const coverage: Record<string, number> = {};
  if (cohort.followOn.kind !== 'fixed') return { coverage, eligibleProbability: 0 };
  const ids = new Set(cohort.followOn.bucketIds);
  const eligible = cohort.buckets.filter((b) => ids.has(b.id));
  const p = eligible.reduce((a, b) => a + b.probability, 0);
  const c = p > 0 ? Math.min(1, cohort.followOn.fractionOfCohort / p) : 0;
  for (const b of cohort.buckets) coverage[b.id] = ids.has(b.id) ? c : 0;
  return { coverage, eligibleProbability: p };
}

export interface CohortEvaluation {
  result: CohortResult;
  ledger: CashFlowLine[];
  /** Cost basis released (company exited or written off), for net-invested-capital tracking. */
  costReleases: { year: number; amount: number }[];
  issues: Issue[];
}

/**
 * Expected-value evaluation of one cohort.
 * expected proceeds = companies × probability × ownership at exit × equity exit value,
 * placed at entry year + years to exit. Investments at entry year and follow-on round years.
 */
export function evaluateCohort(input: CohortModel, fundLifeYears: number): CohortEvaluation {
  const cohort = { ...input, entry: resolveEntry(input.entry) };
  const issues: Issue[] = [];
  const path = `cohorts.${cohort.id}`;
  const ledger: CashFlowLine[] = [];
  const costReleases: { year: number; amount: number }[] = [];
  const rounds = sortedRounds(cohort.rounds);
  const own0 = cohort.entry.ownership;
  const weights = deploymentWeights(cohort);

  if (!(own0 > 0 && own0 < 1)) {
    issues.push({ severity: 'error', code: 'ownership_range', message: `${cohort.label}: entry ownership ${(own0 * 100).toFixed(2)}% must be between 0% and 100%.`, path: `${path}.entry` });
  }
  if (cohort.deployment.mode === 'spread') {
    const s = cohort.deployment.weights.reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > 1e-6) issues.push({ severity: 'error', code: 'deployment_weights', message: `${cohort.label}: deployment weights sum to ${(s * 100).toFixed(1)}%, not 100%.`, path: `${path}.deployment` });
  }

  const { coverage, eligibleProbability } = fixedCoverage(cohort);
  const fo = cohort.followOn;
  if (fo.kind === 'fixed') {
    if (fo.fractionOfCohort > eligibleProbability + 1e-9) {
      issues.push({ severity: 'warning', code: 'fixed_coverage', message: `${cohort.label}: fixed follow-on targets ${(fo.fractionOfCohort * 100).toFixed(0)}% of the cohort, but eligible buckets only hold ${(eligibleProbability * 100).toFixed(0)}%. Only ${(eligibleProbability * 100).toFixed(0)}% receive it.`, path: `${path}.followOn` });
    }
    const r = rounds[fo.roundIndex];
    if (!r) {
      issues.push({ severity: 'warning', code: 'fixed_round_missing', message: `${cohort.label}: fixed follow-on round #${fo.roundIndex + 1} is not in the round schedule; no follow-on is deployed.`, path: `${path}.rounds` });
    } else if (fo.ticket > r.size + 1e-9) {
      issues.push({ severity: 'warning', code: 'fixed_exceeds_round', message: `${cohort.label}: fixed follow-on ${fo.ticket} exceeds the ${r.label} round size ${r.size}.`, path: `${path}.followOn` });
    }
  }
  for (const r of rounds) {
    const d = roundDilution(r);
    if (!(d > 0 && d < 1)) issues.push({ severity: 'error', code: 'round_dilution', message: `${cohort.label}: round ${r.label} dilution ${(d * 100).toFixed(1)}% must be between 0% and 100%.`, path: `${path}.rounds.${r.id}` });
  }

  const bucketResults: BucketResult[] = [];
  const followOnByYear: number[] = [];
  let initialInvested = 0;
  let followOnInvested = 0;
  let proceeds = 0;
  let maxFollowOnPerCompany = 0;

  for (const b of cohort.buckets) {
    const bpath = `${path}.buckets.${b.id}`;
    const { equity, enterprise } = exitEquityValue(b.exit);
    if (b.exit.mode === 'revenue' && b.exit.revenue * b.exit.multiple - b.exit.netDebt < 0) {
      issues.push({ severity: 'warning', code: 'negative_equity', message: `${cohort.label} / ${b.label}: net debt exceeds enterprise value; equity floored at 0.`, path: bpath });
    }
    if (b.roundsReached > rounds.length && fo.kind !== 'none') {
      issues.push({ severity: 'warning', code: 'rounds_reached_exceeds_schedule', message: `${cohort.label} / ${b.label}: reaches ${b.roundsReached} rounds but only ${rounds.length} are modelled.`, path: bpath });
    }
    const reached = rounds.slice(0, Math.min(b.roundsReached, rounds.length));
    const lastRoundYear = reached.length ? reached[reached.length - 1].yearFromEntry : 0;
    if (reached.length && b.yearsToExit < lastRoundYear) {
      issues.push({ severity: 'warning', code: 'exit_before_round', message: `${cohort.label} / ${b.label}: exits in year ${b.yearsToExit} after entry, before its last round (year ${lastRoundYear}).`, path: bpath });
    }
    if (!Number.isInteger(b.yearsToExit) || reached.some((r) => !Number.isInteger(r.yearFromEntry))) {
      issues.push({ severity: 'error', code: 'non_integer_year', message: `${cohort.label} / ${b.label}: timings must be whole years.`, path: bpath });
    }

    // Paths
    const mainPolicy = fo.kind === 'pro_rata' ? ({ kind: 'pro_rata' } as const) : ({ kind: 'none' } as const);
    const main = ownershipPath(own0, cohort, b, mainPolicy);
    const recShare = coverage[b.id] ?? 0;
    let rec: OwnershipPathResult | undefined;
    if (fo.kind === 'fixed' && recShare > 0) {
      if (fo.roundIndex < reached.length) {
        rec = ownershipPath(own0, cohort, b, { kind: 'fixed', ticket: fo.ticket, roundIndex: fo.roundIndex });
      } else {
        issues.push({ severity: 'warning', code: 'fixed_bucket_not_reaching_round', message: `${cohort.label} / ${b.label}: eligible for the fixed follow-on but does not reach round #${fo.roundIndex + 1}; nothing deployed.`, path: bpath });
      }
    }
    const effRecShare = rec ? recShare : 0;
    for (const [label, p] of [['', main], [' (recipient)', rec]] as const) {
      if (!p) continue;
      for (const s of p.steps) {
        if (!(s.ownershipAfter > 0 && s.ownershipAfter < 1) && equity > 0) {
          issues.push({ severity: 'error', code: 'ownership_range', message: `${cohort.label} / ${b.label}${label}: ownership ${(s.ownershipAfter * 100).toFixed(2)}% after "${s.label}" is outside (0%, 100%).`, path: bpath });
          break;
        }
      }
    }

    let bInitial = 0;
    let bFollow = 0;
    let bProceeds = 0;
    const exitYears: number[] = [];
    const groups: { share: number; p: OwnershipPathResult; recipient: boolean | undefined }[] = [];
    if (effRecShare < 1) groups.push({ share: 1 - effRecShare, p: main, recipient: rec ? false : undefined });
    if (rec && effRecShare > 0) groups.push({ share: effRecShare, p: rec, recipient: true });

    for (const { year: v, weight } of weights) {
      const exitYear = v + b.yearsToExit;
      exitYears.push(exitYear);
      for (const g of groups) {
        const n = cohort.companyCount * weight * b.probability * g.share;
        if (n === 0) continue;
        const init = n * cohort.entry.ticket;
        ledger.push({ year: v, kind: 'initial', amount: -init, cohortId: cohort.id, bucketId: b.id, vintage: v, recipient: g.recipient, companies: n });
        bInitial += init;
        let cost = init;
        for (const f of g.p.followOns) {
          const y = v + f.round.yearFromEntry;
          const amt = n * f.amount;
          ledger.push({ year: y, kind: 'follow_on', amount: -amt, cohortId: cohort.id, bucketId: b.id, vintage: v, recipient: g.recipient, roundId: f.round.id, companies: n });
          followOnByYear[y] = (followOnByYear[y] ?? 0) + amt;
          bFollow += amt;
          cost += amt;
        }
        const pr = n * g.p.exitOwnership * equity;
        if (pr > 0) ledger.push({ year: exitYear, kind: 'proceeds', amount: pr, cohortId: cohort.id, bucketId: b.id, vintage: v, recipient: g.recipient, companies: n });
        bProceeds += pr;
        costReleases.push({ year: exitYear, amount: cost });
      }
    }
    const late = exitYears.filter((y) => y > fundLifeYears);
    if (late.length) {
      issues.push({ severity: 'warning', code: 'exit_beyond_life', message: `${cohort.label} / ${b.label}: exits in year${late.length > 1 ? 's' : ''} ${late.join(', ')} fall beyond the ${fundLifeYears}-year fund life. Proceeds are still counted in those years.`, path: bpath });
    }
    initialInvested += bInitial;
    followOnInvested += bFollow;
    proceeds += bProceeds;
    maxFollowOnPerCompany = Math.max(maxFollowOnPerCompany, main.followOnTotal, rec?.followOnTotal ?? 0);

    bucketResults.push({
      bucketId: b.id,
      label: b.label,
      kind: b.kind,
      probability: b.probability,
      expectedCompanies: cohort.companyCount * b.probability,
      yearsToExit: b.yearsToExit,
      equityValue: equity,
      enterpriseValue: enterprise,
      roundsReached: b.roundsReached,
      exitOwnership: main.exitOwnership,
      exitOwnershipRecipient: rec?.exitOwnership,
      recipientShare: effRecShare,
      ownershipPath: main.steps,
      ownershipPathRecipient: rec?.steps,
      initialInvested: bInitial,
      followOnInvested: bFollow,
      followOnPerCompany: main.followOnTotal,
      followOnPerCompanyRecipient: rec?.followOnTotal,
      proceeds: bProceeds,
      shareOfCohortProceeds: 0,
      shareOfFundProceeds: 0,
      exitYears: [...new Set(exitYears)],
    });
  }
  for (const br of bucketResults) br.shareOfCohortProceeds = proceeds > 0 ? br.proceeds / proceeds : 0;
  for (let i = 0; i < followOnByYear.length; i++) followOnByYear[i] = followOnByYear[i] ?? 0;

  const invested = initialInvested + followOnInvested;
  const flows = flowsByYear(ledger.filter((l) => l.kind !== 'fee'));
  return {
    result: {
      cohortId: cohort.id,
      label: cohort.label,
      sleeveId: cohort.sleeveId,
      companyCount: cohort.companyCount,
      entryOwnership: own0,
      initialInvested,
      followOnInvested,
      invested,
      proceeds,
      grossMoic: invested > 0 ? proceeds / invested : null,
      grossIrr: irr(flows),
      maxCompanyExposure: cohort.entry.ticket + maxFollowOnPerCompany,
      buckets: bucketResults,
      followOnByYear,
    },
    ledger,
    costReleases,
    issues,
  };
}

/** Sum ledger amounts into an annual array (index = year). */
export function flowsByYear(lines: Pick<CashFlowLine, 'year' | 'amount'>[], minLength = 0): number[] {
  const maxYear = lines.reduce((m, l) => Math.max(m, l.year), minLength - 1);
  const out = new Array(Math.max(0, maxYear + 1)).fill(0);
  for (const l of lines) out[l.year] += l.amount;
  return out;
}
