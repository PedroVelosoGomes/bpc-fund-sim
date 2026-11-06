import { evaluateFund } from './fund';
import { defaultResidualBucket, setRateWithResidual } from './probabilities';
import type { FundModel, FundResult, IrrResult } from './types';

export type SensitivityVariable =
  | 'exitValueMultiplier'
  | 'timeToExitShift'
  | 'dilutionMultiplier'
  | 'entryValuationMultiplier'
  | 'ticketMultiplier'
  | 'writeOffRateShift'
  | 'companyCountMultiplier';

export type SensitivityMetric = 'grossMoic' | 'grossIrr' | 'netMultiple' | 'netIrr';

export const SENSITIVITY_VARIABLES: Record<SensitivityVariable, { label: string; unit: 'x' | 'years' | 'pp'; neutral: number; defaultStep: number }> = {
  exitValueMultiplier: { label: 'Exit value multiplier', unit: 'x', neutral: 1, defaultStep: 0.25 },
  timeToExitShift: { label: 'Time-to-exit shift', unit: 'years', neutral: 0, defaultStep: 1 },
  dilutionMultiplier: { label: 'Dilution multiplier', unit: 'x', neutral: 1, defaultStep: 0.15 },
  entryValuationMultiplier: { label: 'Entry valuation multiplier', unit: 'x', neutral: 1, defaultStep: 0.15 },
  ticketMultiplier: { label: 'Initial ticket multiplier', unit: 'x', neutral: 1, defaultStep: 0.15 },
  writeOffRateShift: { label: 'Write-off rate shift', unit: 'pp', neutral: 0, defaultStep: 0.05 },
  companyCountMultiplier: { label: 'Company count multiplier', unit: 'x', neutral: 1, defaultStep: 0.15 },
};

/** Symmetric axis of n values (default 7) centred on the neutral value. */
export function defaultAxis(variable: SensitivityVariable, n = 7, step?: number): number[] {
  const meta = SENSITIVITY_VARIABLES[variable];
  const s = step ?? meta.defaultStep;
  const half = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => +(meta.neutral + (i - half) * s).toFixed(10)).filter((v) => meta.unit !== 'x' || v > 0);
}

/**
 * Apply one perturbation to a model, returning a new model.
 *  - exitValueMultiplier: scales every bucket's equity exit value.
 *  - timeToExitShift: adds whole years to every bucket's time to exit (floored at 0).
 *  - dilutionMultiplier: scales cumulative dilution (capped at 99%) and each round's dilution (via post-money; round size fixed).
 *  - entryValuationMultiplier: scales entry post-money; ticket fixed; ownership derived.
 *  - ticketMultiplier: scales entry ticket; post-money fixed; ownership derived.
 *  - writeOffRateShift: adds to write-off probability; the residual bucket absorbs the change (clamped feasible).
 *  - companyCountMultiplier: scales company counts.
 */
export function perturb(model: FundModel, variable: SensitivityVariable, value: number): FundModel {
  const cohorts = model.cohorts.map((c) => {
    switch (variable) {
      case 'exitValueMultiplier':
        return {
          ...c,
          buckets: c.buckets.map((b) => ({
            ...b,
            exit: b.exit.mode === 'equity' ? { ...b.exit, equityValue: b.exit.equityValue * value } : { ...b.exit, multiple: b.exit.multiple * value, netDebt: b.exit.netDebt * value },
          })),
        };
      case 'timeToExitShift':
        return { ...c, buckets: c.buckets.map((b) => ({ ...b, yearsToExit: Math.max(0, Math.round(b.yearsToExit + value)) })) };
      case 'dilutionMultiplier':
        return {
          ...c,
          buckets: c.buckets.map((b) => ({ ...b, cumulativeDilution: Math.min(0.99, b.cumulativeDilution * value) })),
          rounds: c.rounds.map((r) => ({ ...r, postMoney: value > 0 ? r.postMoney / value : r.postMoney })),
        };
      case 'entryValuationMultiplier':
        return { ...c, entry: { ...c.entry, postMoney: c.entry.postMoney * value, ownership: c.entry.ticket / (c.entry.postMoney * value), derived: 'ownership' as const } };
      case 'ticketMultiplier':
        return { ...c, entry: { ...c.entry, ticket: c.entry.ticket * value, ownership: (c.entry.ticket * value) / c.entry.postMoney, derived: 'ownership' as const } };
      case 'companyCountMultiplier':
        return { ...c, companyCount: c.companyCount * value };
      case 'writeOffRateShift': {
        const residual = defaultResidualBucket(c.buckets, c.residualBucketId);
        let buckets = c.buckets;
        for (const w of c.buckets.filter((b) => b.kind === 'writeoff')) {
          if (!residual || residual === w.id) continue;
          const res = buckets.find((b) => b.id === residual)!;
          const cur = buckets.find((b) => b.id === w.id)!;
          const target = Math.max(0, Math.min(cur.probability + value, cur.probability + res.probability));
          buckets = setRateWithResidual(buckets, w.id, target, residual) ?? buckets;
        }
        return { ...c, buckets };
      }
    }
  });
  return { ...model, cohorts };
}

export function metricValue(r: FundResult, metric: SensitivityMetric): number | null {
  const fromIrr = (i: IrrResult) => (i.ok ? i.value : null);
  switch (metric) {
    case 'grossMoic':
      return r.gross.moic;
    case 'grossIrr':
      return fromIrr(r.gross.irr);
    case 'netMultiple':
      return r.net.available ? r.net.netMultiple : null;
    case 'netIrr':
      return r.net.available ? fromIrr(r.net.netIrr) : null;
  }
}

export interface SensitivityGrid {
  x: { variable: SensitivityVariable; values: number[] };
  y: { variable: SensitivityVariable; values: number[] };
  metric: SensitivityMetric;
  /** cells[yi][xi] */
  cells: (number | null)[][];
}

export function sensitivityGrid(
  model: FundModel,
  x: { variable: SensitivityVariable; values?: number[] },
  y: { variable: SensitivityVariable; values?: number[] },
  metric: SensitivityMetric,
): SensitivityGrid {
  const xv = x.values ?? defaultAxis(x.variable);
  const yv = y.values ?? defaultAxis(y.variable);
  const cells = yv.map((yy) => xv.map((xx) => metricValue(evaluateFund(perturb(perturb(model, y.variable, yy), x.variable, xx)), metric)));
  return { x: { variable: x.variable, values: xv }, y: { variable: y.variable, values: yv }, metric, cells };
}
