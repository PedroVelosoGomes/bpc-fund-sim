import type { FundResult } from '../../engine';
import type { MetricKey } from '../state/store';
import { IRR_TOOLTIP, irrFmt, money, mult, pct } from './format';

export interface MetricDef {
  key: MetricKey;
  label: string;
  group: 'Capital' | 'Returns' | 'Shape';
  value: (r: FundResult) => number | null;
  format: (r: FundResult) => string;
  /** +1 if higher is better, −1 if lower is better, 0 neutral. */
  better: 1 | -1 | 0;
  deltaFormat?: (d: number) => string;
  tip: string;
  netNote?: boolean;
}

const irrVal = (i: FundResult['gross']['irr']) => (i.ok ? i.value : null);

export const METRICS: MetricDef[] = [
  { key: 'committed', label: 'Committed', group: 'Capital', value: (r) => r.capital.committed, format: (r) => money(r.capital.committed), better: 0, tip: 'Total LP commitments.' },
  { key: 'fees', label: 'Management fees', group: 'Capital', value: (r) => r.capital.totalFees, format: (r) => money(r.capital.totalFees), better: -1, tip: 'Lifetime management fees, called from LPs as paid-in capital.' },
  { key: 'investable', label: 'Investable', group: 'Capital', value: (r) => r.capital.investable, format: (r) => money(r.capital.investable), better: 0, tip: 'Committed − lifetime fees.' },
  { key: 'invested', label: 'Invested', group: 'Capital', value: (r) => r.capital.invested, format: (r) => money(r.capital.invested), better: 0, tip: 'Initial + follow-on investments (expected). Excludes fees.' },
  { key: 'paidIn', label: 'Paid-in', group: 'Capital', value: (r) => r.capital.paidIn, format: (r) => money(r.capital.paidIn), better: 0, tip: 'Capital called from LPs: invested + fees.' },
  { key: 'reserveUsed', label: 'Reserve used', group: 'Capital', value: (r) => r.capital.reserveUsed, format: (r) => `${money(r.capital.reserveUsed)} / ${money(r.capital.reserve)}`, better: 0, tip: 'Planned follow-ons drawn against the earmarked reserve.' },
  { key: 'unusedCapacity', label: 'Unused capacity', group: 'Capital', value: (r) => r.capital.unusedCapacity, format: (r) => money(r.capital.unusedCapacity), better: 0, tip: 'Direct investable capital not deployed (negative = over-allocated).' },
  { key: 'overAllocation', label: 'Over-allocation', group: 'Capital', value: (r) => r.capital.reserveOverAllocation + Math.max(0, -r.capital.unusedCapacity), format: (r) => money(r.capital.reserveOverAllocation + Math.max(0, -r.capital.unusedCapacity)), better: -1, tip: 'Follow-ons above reserve plus investments above investable capital.' },
  { key: 'grossProceeds', label: 'Gross proceeds', group: 'Returns', value: (r) => r.gross.proceeds, format: (r) => money(r.gross.proceeds), better: 1, tip: 'Σ companies × probability × exit ownership × equity exit value.' },
  { key: 'grossMoic', label: 'Gross MOIC', group: 'Returns', value: (r) => r.gross.moic, format: (r) => mult(r.gross.moic), better: 1, deltaFormat: (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}×`, tip: 'Gross proceeds / invested capital.' },
  { key: 'grossIrr', label: 'Gross IRR', group: 'Returns', value: (r) => irrVal(r.gross.irr), format: (r) => irrFmt(r.gross.irr), better: 1, deltaFormat: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`, tip: `Investment and proceeds flows only, excluding fees. ${IRR_TOOLTIP}` },
  { key: 'netMultiple', label: 'Net LP multiple', group: 'Returns', value: (r) => (r.net.available ? r.net.netMultiple : null), format: (r) => (r.net.available ? mult(r.net.netMultiple) : 'N/A — enable fees and carry'), better: 1, deltaFormat: (d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}×`, tip: 'LP distributions after carry / paid-in capital.', netNote: true },
  { key: 'netIrr', label: 'Net IRR', group: 'Returns', value: (r) => (r.net.available ? irrVal(r.net.netIrr) : null), format: (r) => (r.net.available ? irrFmt(r.net.netIrr) : 'N/A — enable fees and carry'), better: 1, deltaFormat: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`, tip: `LP flows: −(investments + fees) + distributions after carry. ${IRR_TOOLTIP}`, netNote: true },
  { key: 'gpCarry', label: 'GP carry', group: 'Returns', value: (r) => (r.net.available ? r.net.waterfall?.gpCarry ?? 0 : null), format: (r) => (r.net.available ? money(r.net.waterfall?.gpCarry) : 'N/A'), better: 0, tip: 'Carried interest paid to the GP under the waterfall.', netNote: true },
  { key: 'outlierShare', label: 'Outlier share of proceeds', group: 'Shape', value: (r) => r.outlierShare, format: (r) => pct(r.outlierShare), better: 0, deltaFormat: (d) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`, tip: 'Share of gross proceeds coming from outlier-bucket outcomes.' },
  { key: 'timeToFirstDistribution', label: 'Time to first distribution', group: 'Shape', value: (r) => r.timeToFirstDistribution, format: (r) => (r.timeToFirstDistribution == null ? 'N/A' : `year ${r.timeToFirstDistribution}`), better: -1, deltaFormat: (d) => `${d > 0 ? '+' : ''}${d} yr`, tip: 'First year with expected proceeds.' },
];

export const metricDef = (k: MetricKey) => METRICS.find((m) => m.key === k)!;
