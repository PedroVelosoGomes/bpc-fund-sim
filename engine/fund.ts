import { evaluateCohort, flowsByYear } from './cohort';
import { feeSchedule } from './fees';
import { irr } from './irr';
import { probabilitySum, PROBABILITY_TOLERANCE } from './probabilities';
import { europeanWaterfall, EUROPEAN_CONVENTION_LABEL } from './waterfall';
import type { AnnualRow, CapitalSummary, CashFlowLine, CohortResult, FundModel, FundResult, FundTerms, Issue, NetResult } from './types';

/** Reserve capacity in millions. Percent mode is a share of investable capital. */
export function reserveAmount(fund: FundTerms, investable: number): number {
  return fund.reserve.mode === 'amount' ? fund.reserve.value : fund.reserve.value * investable;
}

export function validateFundTerms(fund: FundTerms): Issue[] {
  const issues: Issue[] = [];
  const p = 'fund';
  if (!(fund.committedCapital > 0)) issues.push({ severity: 'error', code: 'committed', message: 'Committed capital must be positive.', path: `${p}.committedCapital` });
  if (!Number.isInteger(fund.fundLifeYears) || fund.fundLifeYears < 1) issues.push({ severity: 'error', code: 'fund_life', message: 'Fund life must be a whole number of years ≥ 1.', path: `${p}.fundLifeYears` });
  if (!Number.isInteger(fund.investmentPeriodYears) || fund.investmentPeriodYears < 0 || fund.investmentPeriodYears > fund.fundLifeYears)
    issues.push({ severity: 'error', code: 'investment_period', message: 'Investment period must be a whole number of years within the fund life.', path: `${p}.investmentPeriodYears` });
  if (fund.carry.enabled && !(fund.carry.catchUpRate > fund.carry.carryRate))
    issues.push({ severity: 'error', code: 'catch_up', message: 'Catch-up rate must exceed the carry rate.', path: `${p}.carry.catchUpRate` });
  if (fund.reserve.mode === 'percent' && (fund.reserve.value < 0 || fund.reserve.value > 1))
    issues.push({ severity: 'error', code: 'reserve_pct', message: 'Reserve % must be between 0% and 100%.', path: `${p}.reserve` });
  return issues;
}

/**
 * Evaluate a fund in the deterministic expected-value model ("expected cash-flow case").
 * Pure and deterministic: same input → same output.
 */
export function evaluateFund(model: FundModel): FundResult {
  const { fund } = model;
  const issues: Issue[] = [...validateFundTerms(fund)];
  const ledger: CashFlowLine[] = [];
  const costReleases: { year: number; amount: number }[] = [];
  const cohorts: CohortResult[] = [];

  for (const c of model.cohorts) {
    const s = probabilitySum(c.buckets);
    if (Math.abs(s - 1) > PROBABILITY_TOLERANCE) {
      issues.push({ severity: 'error', code: 'probability_sum', message: `${c.label}: outcome probabilities sum to ${(s * 100).toFixed(2)}%, not 100%.`, path: `cohorts.${c.id}.buckets` });
    }
    const ev = evaluateCohort(c, fund.fundLifeYears);
    cohorts.push(ev.result);
    ledger.push(...ev.ledger);
    costReleases.push(...ev.costReleases);
    issues.push(...ev.issues);
  }

  const horizon = Math.max(fund.fundLifeYears, ...ledger.map((l) => l.year)) + 0;
  const len = horizon + 1;

  // Net invested capital by year (cost of unrealised companies at year end)
  const investedByYear = flowsByYear(ledger.filter((l) => l.kind === 'initial' || l.kind === 'follow_on').map((l) => ({ year: l.year, amount: -l.amount })), len);
  const releasedByYear = flowsByYear(costReleases, len);
  const nic: number[] = [];
  let acc = 0;
  for (let t = 0; t < len; t++) {
    acc += (investedByYear[t] ?? 0) - (releasedByYear[t] ?? 0);
    nic[t] = Math.max(0, acc);
  }

  const fees = feeSchedule(fund, nic);
  fees.forEach((f, year) => {
    if (f > 0) ledger.push({ year, kind: 'fee', amount: -f });
  });
  const totalFees = fees.reduce((a, b) => a + b, 0);

  // Capital
  const initialInvested = cohorts.reduce((a, c) => a + c.initialInvested, 0);
  const followOnInvested = cohorts.reduce((a, c) => a + c.followOnInvested, 0);
  const invested = initialInvested + followOnInvested;
  const investable = fund.committedCapital - totalFees;
  const separateSleeves = fund.sleeves.filter((s) => s.use === 'separate').reduce((a, s) => a + s.amount, 0);
  const directInvestable = investable - separateSleeves;
  const reserve = reserveAmount(fund, investable);
  const initialBudget = directInvestable - reserve;
  const sleeveTotal = fund.sleeves.reduce((a, s) => a + s.amount, 0);
  const sleeveUsage = fund.sleeves.map((s) => {
    const inv = s.use === 'direct' ? cohorts.filter((c) => c.sleeveId === s.id).reduce((a, c) => a + c.invested, 0) : 0;
    return { sleeveId: s.id, label: s.label, amount: s.amount, use: s.use, invested: inv, remaining: s.amount - inv };
  });
  const capital: CapitalSummary = {
    committed: fund.committedCapital,
    totalFees,
    investable,
    separateSleeves,
    directInvestable,
    reserve,
    initialBudget,
    initialInvested,
    followOnInvested,
    invested,
    paidIn: invested + totalFees,
    reserveUsed: Math.min(followOnInvested, reserve),
    reserveUnused: Math.max(0, reserve - followOnInvested),
    reserveOverAllocation: Math.max(0, followOnInvested - reserve),
    initialOverAllocation: Math.max(0, initialInvested - initialBudget),
    unusedCapacity: directInvestable - invested,
    sleeveGap: fund.sleeves.length ? sleeveTotal - investable : 0,
    sleeveUsage,
  };

  if (invested > directInvestable + 1e-9)
    issues.push({ severity: 'error', code: 'over_investable', message: `Total investments ${invested.toFixed(1)} exceed investable capital ${directInvestable.toFixed(1)}${separateSleeves ? ' (after separate-use sleeves)' : ''}.`, path: 'fund' });
  if (capital.reserveOverAllocation > 1e-9)
    issues.push({ severity: 'warning', code: 'reserve_over_allocated', message: `Planned follow-ons ${followOnInvested.toFixed(1)} exceed the reserve ${reserve.toFixed(1)} by ${capital.reserveOverAllocation.toFixed(1)}.`, path: 'fund.reserve' });
  if (capital.initialOverAllocation > 1e-9)
    issues.push({ severity: 'warning', code: 'initial_over_budget', message: `Initial investments ${initialInvested.toFixed(1)} exceed the initial budget ${initialBudget.toFixed(1)} (investable − reserve${separateSleeves ? ' − separate sleeves' : ''}).`, path: 'fund' });
  for (const s of sleeveUsage) {
    if (s.use === 'direct' && s.invested > s.amount + 1e-9)
      issues.push({ severity: 'warning', code: 'sleeve_over', message: `Sleeve ${s.label}: investments ${s.invested.toFixed(1)} exceed its ${s.amount.toFixed(1)} allocation.`, path: `fund.sleeves.${s.sleeveId}` });
  }
  if (fund.fees.enabled && capital.sleeveGap > 1e-9)
    issues.push({ severity: 'info', code: 'sleeve_gap', message: `Sleeves total ${sleeveTotal.toFixed(1)} but investable capital after fees is ${investable.toFixed(1)} (gap ${capital.sleeveGap.toFixed(1)}).`, path: 'fund.sleeves' });

  // Annual
  const sumKind = (kind: CashFlowLine['kind']) => flowsByYear(ledger.filter((l) => l.kind === kind), len).map((x) => -x);
  const init = sumKind('initial');
  const follow = sumKind('follow_on');
  const feeArr = sumKind('fee');
  const proceeds = flowsByYear(ledger.filter((l) => l.kind === 'proceeds'), len);
  const paidIn = init.map((x, t) => x + follow[t] + feeArr[t]);
  const grossFlows = init.map((x, t) => proceeds[t] - x - follow[t]);

  const netAvailable = fund.fees.enabled && fund.carry.enabled;
  const wf = europeanWaterfall(paidIn, proceeds, fund.carry);
  const lpDist = netAvailable ? wf.lpDistributions : proceeds.slice();
  const gpCarry = netAvailable ? wf.gpCarry : new Array(len).fill(0);

  const annual: AnnualRow[] = [];
  let cumLp = 0;
  let cumGross = 0;
  let cumFollow = 0;
  for (let t = 0; t < len; t++) {
    const lpNet = lpDist[t] - paidIn[t];
    cumLp += lpNet;
    cumGross += grossFlows[t];
    cumFollow += follow[t];
    annual.push({
      year: t,
      initialInvestment: init[t],
      followOnInvestment: follow[t],
      fees: feeArr[t],
      paidIn: paidIn[t],
      grossProceeds: proceeds[t],
      grossNetFlow: grossFlows[t],
      lpDistributions: lpDist[t],
      gpCarry: gpCarry[t],
      lpNetFlow: lpNet,
      cumulativeLpNetFlow: cumLp,
      cumulativeGrossNetFlow: cumGross,
      netInvestedCapital: nic[t],
      cumulativeFollowOn: cumFollow,
      reserveRemaining: reserve - cumFollow,
      reserveOverAllocated: cumFollow > reserve + 1e-9,
    });
  }

  const totalProceeds = proceeds.reduce((a, b) => a + b, 0);
  const totalPaidIn = capital.paidIn;
  const net: NetResult = netAvailable
    ? {
        available: true,
        convention: EUROPEAN_CONVENTION_LABEL(fund.carry),
        netMultiple: totalPaidIn > 0 ? wf.totals.lpDistributions / totalPaidIn : null,
        netIrr: irr(lpDist.map((d, t) => d - paidIn[t])),
        waterfall: wf.totals,
      }
    : {
        available: false,
        reason: 'N/A — enable fees and carry',
        convention: EUROPEAN_CONVENTION_LABEL(fund.carry),
        netMultiple: null,
        netIrr: { ok: false, reason: 'empty' },
      };

  // Shares
  let outlierProceeds = 0;
  for (const c of cohorts)
    for (const b of c.buckets) {
      b.shareOfFundProceeds = totalProceeds > 0 ? b.proceeds / totalProceeds : 0;
      if (b.kind === 'outlier') outlierProceeds += b.proceeds;
    }
  const firstDist = proceeds.findIndex((p) => p > 1e-12);

  return {
    label: 'expected cash-flow case',
    currency: fund.currency,
    capital,
    gross: { proceeds: totalProceeds, moic: invested > 0 ? totalProceeds / invested : null, irr: irr(grossFlows) },
    net,
    annual,
    ledger,
    cohorts,
    outlierProceeds,
    outlierShare: totalProceeds > 0 ? outlierProceeds / totalProceeds : null,
    timeToFirstDistribution: firstDist >= 0 ? firstDist : null,
    issues: dedupeIssues(issues),
  };
}

function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.severity}|${i.code}|${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
