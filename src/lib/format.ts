import { irrLabel, type IrrResult, type Provenance } from '../../engine';

/** Snap values that would display as −0.0 to 0. */
const clean = (v: number, d: number) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v);
export const money = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : clean(v, d).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${clean(v * 100, d).toFixed(d)}%`);
export const mult = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}×`);
export const irrFmt = (r: IrrResult) => irrLabel(r);
export const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + money(v, d);

export function provenanceText(p: Provenance | undefined): string {
  if (!p) return 'Default value (no recorded source)';
  switch (p.kind) {
    case 'benchmark':
      return `Benchmark · ${p.source} · as of ${p.asOf} · unit ${p.unit}${p.note ? ` · ${p.note}` : ''}`;
    case 'demo':
      return `Demo data${p.note && p.note !== 'demo data' ? ` · ${p.note}` : ''} — illustrative, not a benchmark`;
    case 'user':
      return `User override${p.at ? ` · ${new Date(p.at).toLocaleString()}` : ''}${p.previous ? ` · was ${provenanceText(p.previous)}` : ''}`;
  }
}

export const provClass = (p: Provenance | undefined) => `prov prov-${p?.kind ?? 'default'}`;

export const IRR_TOOLTIP =
  'IRR of the expected cash flows (annual periods, flows at year end). This is NOT the average IRR of simulated paths — the IRR of an average differs from the average of IRRs.';
