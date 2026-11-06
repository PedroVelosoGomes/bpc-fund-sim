/**
 * Benchmark packs: parsing (CSV / JSON), unit normalisation, matching to assumptions, and
 * Downside / Base / Upside market-case generation.
 *
 * Row schema: metric, stage, geography, vintage, unit, low, base, high, source, as_of, notes.
 * Metrics: initial_ticket, entry_post_money, entry_ownership, dilution_per_round, cumulative_dilution,
 * time_to_exit, exit_equity_value, exit_revenue_multiple, outcome_rate_<bucket>.
 * Bucket-level metrics (cumulative_dilution, time_to_exit, exit_equity_value, exit_revenue_multiple) accept an
 * optional `_<bucket>` suffix (bucket kind such as `outlier`, or a bucket id). Suffixed rows take precedence.
 */
import { checkEntryConsistency, resolveEntry } from './entry';
import { defaultResidualBucket } from './probabilities';
import type { CohortStrategy, MarketCase, MarketProfile, Strategy } from './scenario';
import type { EntryField, Issue, OutcomeBucket, Provenance, ProvenanceMap } from './types';

export const BENCHMARK_COLUMNS = ['metric', 'stage', 'geography', 'vintage', 'unit', 'low', 'base', 'high', 'source', 'as_of', 'notes'] as const;

export const BASE_METRICS = [
  'initial_ticket',
  'entry_post_money',
  'entry_ownership',
  'dilution_per_round',
  'cumulative_dilution',
  'time_to_exit',
  'exit_equity_value',
  'exit_revenue_multiple',
  'outcome_rate',
] as const;
export type BaseMetric = (typeof BASE_METRICS)[number];

/** Metrics that may carry a `_<bucket>` suffix. outcome_rate requires one. */
export const BUCKET_METRICS: BaseMetric[] = ['cumulative_dilution', 'time_to_exit', 'exit_equity_value', 'exit_revenue_multiple', 'outcome_rate'];

type UnitKind = 'money' | 'rate' | 'years' | 'multiple';
export const METRIC_UNIT: Record<BaseMetric, UnitKind> = {
  initial_ticket: 'money',
  entry_post_money: 'money',
  exit_equity_value: 'money',
  entry_ownership: 'rate',
  dilution_per_round: 'rate',
  cumulative_dilution: 'rate',
  outcome_rate: 'rate',
  time_to_exit: 'years',
  exit_revenue_multiple: 'multiple',
};

export const METRIC_LABEL: Record<BaseMetric, string> = {
  initial_ticket: 'Initial ticket',
  entry_post_money: 'Entry post-money',
  entry_ownership: 'Entry ownership',
  dilution_per_round: 'Dilution per round',
  cumulative_dilution: 'Cumulative dilution',
  time_to_exit: 'Time to exit',
  exit_equity_value: 'Exit equity value',
  exit_revenue_multiple: 'Exit revenue multiple',
  outcome_rate: 'Outcome rate',
};

export interface BenchmarkRow {
  id: string;
  /** 1-based line number in the source file (CSV) or index (JSON). */
  rowNumber: number;
  metric: string;
  baseMetric: BaseMetric;
  bucket?: string;
  stage: string;
  geography: string;
  vintage: number | null;
  unit: string;
  low: number;
  base: number;
  high: number;
  source: string;
  asOf: string;
  notes: string;
}

export interface BenchmarkPack {
  id: string;
  name: string;
  importedAt: string;
  format: 'csv' | 'json';
  /** True only when the source explicitly reports low/base/high as percentiles. */
  percentileBacked: boolean;
  rows: BenchmarkRow[];
  parseIssues: Issue[];
}

export const BENCHMARK_CSV_TEMPLATE = `# Benchmark pack template. Lines starting with # are ignored.
# metric: initial_ticket | entry_post_money | entry_ownership | dilution_per_round | cumulative_dilution[_bucket]
#         time_to_exit[_bucket] | exit_equity_value[_bucket] | exit_revenue_multiple[_bucket] | outcome_rate_<bucket>
# bucket: writeoff | modest | strong | outlier (or a bucket id). Unsuffixed exit/timing rows apply to all non-write-off buckets.
# unit:   money = <CCY>_m (e.g. EUR_m; _k / _bn are converted with a flag); rates = pct or fraction; time = years; multiples = x
# low / base / high: low <= base <= high. Leave low/high blank to use base.
${BENCHMARK_COLUMNS.join(',')}
initial_ticket,seed,europe,2025,EUR_m,2,3,4,Your source,2026-06-30,
entry_post_money,seed,europe,2025,EUR_m,10,15,22,Your source,2026-06-30,
outcome_rate_writeoff,seed,europe,2025,pct,42,50,60,Your source,2026-06-30,
exit_equity_value_outlier,seed,europe,2025,EUR_m,700,1200,2000,Your source,2026-06-30,
`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseMetric(raw: string): { baseMetric: BaseMetric; bucket?: string } | null {
  const m = raw.trim().toLowerCase();
  if ((BASE_METRICS as readonly string[]).includes(m) && m !== 'outcome_rate') return { baseMetric: m as BaseMetric };
  for (const b of [...BUCKET_METRICS].sort((a, z) => z.length - a.length)) {
    if (m.startsWith(`${b}_`) && m.length > b.length + 1) return { baseMetric: b, bucket: m.slice(b.length + 1) };
  }
  return null;
}

/** RFC 4180-ish CSV parser: quotes, escaped quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const num = (s: unknown): number | null => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string' || s.trim() === '') return null;
  const n = Number(s.trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function buildRow(rec: Record<string, unknown>, rowNumber: number, issues: Issue[], idPrefix: string): BenchmarkRow | null {
  const where = `row ${rowNumber}`;
  const metricRaw = String(rec.metric ?? '').trim();
  if (!metricRaw) {
    issues.push({ severity: 'error', code: 'missing_metric', message: `${where}: metric is empty; row skipped.`, path: where });
    return null;
  }
  const pm = parseMetric(metricRaw);
  if (!pm) {
    issues.push({ severity: 'error', code: 'unknown_metric', message: `${where}: unknown metric "${metricRaw}"; row skipped.`, path: where });
    return null;
  }
  const stage = String(rec.stage ?? '').trim().toLowerCase();
  if (!stage) {
    issues.push({ severity: 'error', code: 'missing_stage', message: `${where}: stage is empty; row skipped.`, path: where });
    return null;
  }
  const base = num(rec.base);
  if (base === null) {
    issues.push({ severity: 'error', code: 'missing_base', message: `${where}: base value is missing or not a number; row skipped.`, path: where });
    return null;
  }
  let low = num(rec.low);
  let high = num(rec.high);
  if (low === null || high === null) {
    issues.push({ severity: 'info', code: 'range_missing', message: `${where} (${metricRaw}): low/high missing; base value used for the missing end.`, path: where });
    low = low ?? base;
    high = high ?? base;
  }
  const vRaw = rec.vintage;
  const vintage = num(vRaw as string);
  if (vRaw !== undefined && vRaw !== null && String(vRaw).trim() !== '' && vintage === null)
    issues.push({ severity: 'warning', code: 'bad_vintage', message: `${where}: vintage "${vRaw}" is not a year; treated as blank.`, path: where });
  return {
    id: `${idPrefix}-${rowNumber}`,
    rowNumber,
    metric: metricRaw.toLowerCase(),
    baseMetric: pm.baseMetric,
    bucket: pm.bucket,
    stage,
    geography: String(rec.geography ?? '').trim().toLowerCase(),
    vintage: vintage === null ? null : Math.round(vintage),
    unit: String(rec.unit ?? '').trim(),
    low,
    base,
    high,
    source: String(rec.source ?? '').trim(),
    asOf: String(rec.as_of ?? rec.asOf ?? '').trim(),
    notes: String(rec.notes ?? '').trim(),
  };
}

export function parseBenchmarkCsv(text: string, meta: { id: string; name: string; importedAt: string; percentileBacked?: boolean }): BenchmarkPack {
  const issues: Issue[] = [];
  const physical = text.replace(/^﻿/, '').split(/\r?\n/);
  // Keep line numbers stable: blank out comment lines instead of removing them.
  const cleaned = physical.map((l) => (l.trim().startsWith('#') ? '' : l)).join('\n');
  const table = parseCsv(cleaned);
  // Recover the 1-based source line for each parsed record (approximate for multi-line quoted fields).
  let line = 0;
  const records: { cells: string[]; line: number }[] = [];
  for (const cells of table) {
    line++; // comment lines were blanked (not removed), so records align with physical lines
    if (cells.every((c) => c.trim() === '')) continue;
    records.push({ cells, line });
  }
  const rows: BenchmarkRow[] = [];
  if (!records.length) {
    issues.push({ severity: 'error', code: 'empty', message: 'The file has no header or rows.' });
    return { ...meta, format: 'csv', percentileBacked: !!meta.percentileBacked, rows, parseIssues: issues };
  }
  const header = records[0].cells.map((h) => h.trim().toLowerCase());
  const missing = BENCHMARK_COLUMNS.filter((c) => c !== 'notes' && !header.includes(c));
  if (missing.length) {
    issues.push({ severity: 'error', code: 'missing_columns', message: `Missing column(s): ${missing.join(', ')}. Expected: ${BENCHMARK_COLUMNS.join(', ')}.` });
    return { ...meta, format: 'csv', percentileBacked: !!meta.percentileBacked, rows, parseIssues: issues };
  }
  const extra = header.filter((h) => h && !(BENCHMARK_COLUMNS as readonly string[]).includes(h));
  if (extra.length) issues.push({ severity: 'info', code: 'extra_columns', message: `Ignored column(s): ${extra.join(', ')}.` });
  for (const r of records.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = r.cells[i] ?? ''));
    const row = buildRow(rec, r.line, issues, meta.id);
    if (row) rows.push(row);
  }
  return { ...meta, format: 'csv', percentileBacked: !!meta.percentileBacked, rows, parseIssues: issues };
}

/** JSON: either an array of row objects or { name?, percentileBacked?, rows: [...] }. Keys as in the CSV header. */
export function parseBenchmarkJson(text: string, meta: { id: string; name: string; importedAt: string; percentileBacked?: boolean }): BenchmarkPack {
  const issues: Issue[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    issues.push({ severity: 'error', code: 'bad_json', message: `Not valid JSON: ${(e as Error).message}` });
    return { ...meta, format: 'json', percentileBacked: !!meta.percentileBacked, rows: [], parseIssues: issues };
  }
  const obj = data as { name?: string; percentileBacked?: boolean; rows?: unknown };
  const list = Array.isArray(data) ? data : Array.isArray(obj?.rows) ? (obj.rows as unknown[]) : null;
  if (!list) {
    issues.push({ severity: 'error', code: 'bad_shape', message: 'Expected an array of rows or an object with a "rows" array.' });
    return { ...meta, format: 'json', percentileBacked: !!meta.percentileBacked, rows: [], parseIssues: issues };
  }
  const rows: BenchmarkRow[] = [];
  list.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object') {
      issues.push({ severity: 'error', code: 'bad_row', message: `row ${i + 1}: not an object; skipped.` });
      return;
    }
    const row = buildRow(rec as Record<string, unknown>, i + 1, issues, meta.id);
    if (row) rows.push(row);
  });
  return {
    ...meta,
    name: !Array.isArray(data) && obj.name ? String(obj.name) : meta.name,
    format: 'json',
    percentileBacked: !Array.isArray(data) && typeof obj.percentileBacked === 'boolean' ? obj.percentileBacked : !!meta.percentileBacked,
    rows,
    parseIssues: issues,
  };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface NormalizedRow extends BenchmarkRow {
  /** Values converted to model units (millions of fund currency, decimals, years, multiples). */
  value: { low: number; base: number; high: number };
  factor: number;
  usable: boolean;
  issues: Issue[];
}

const MONEY_SCALE: Record<string, number> = { '': 1, m: 1, mm: 1, mn: 1, million: 1, millions: 1, k: 0.001, thousand: 0.001, thousands: 0.001, bn: 1000, b: 1000, billion: 1000 };

/** Unit check and conversion factor. Currency differences are blocking (never converted). Scale differences convert with a flag. */
export function unitFactor(metric: BaseMetric, unit: string, fundCurrency: string): { factor: number; issues: Issue[]; blocking: boolean } {
  const u = unit.trim();
  const lu = u.toLowerCase();
  const issues: Issue[] = [];
  switch (METRIC_UNIT[metric]) {
    case 'money': {
      const m = /^([a-z]{3})?[\s_]*([a-z]*)$/i.exec(u.replace(/^€/, 'EUR').replace(/^\$/, 'USD').replace(/^£/, 'GBP'));
      if (!m) return { factor: 1, issues: [{ severity: 'error', code: 'unit_unrecognised', message: `Unit "${unit}" is not a money unit (expected e.g. ${fundCurrency}_m).` }], blocking: true };
      const ccy = (m[1] ?? '').toUpperCase();
      const scaleKey = (m[2] ?? '').toLowerCase();
      if (!(scaleKey in MONEY_SCALE)) return { factor: 1, issues: [{ severity: 'error', code: 'unit_unrecognised', message: `Unit "${unit}": unknown scale "${m[2]}" (use m, k or bn).` }], blocking: true };
      if (!ccy) issues.push({ severity: 'warning', code: 'currency_missing', message: `Unit "${unit}" states no currency; read as ${fundCurrency}. Check the source.` });
      else if (ccy !== fundCurrency.toUpperCase())
        return { factor: 1, issues: [{ severity: 'error', code: 'currency_mismatch', message: `Currency ${ccy} differs from fund currency ${fundCurrency}. Not applied — no FX conversion is performed.` }], blocking: true };
      const f = MONEY_SCALE[scaleKey];
      if (scaleKey === '') issues.push({ severity: 'warning', code: 'scale_missing', message: `Unit "${unit}" states no scale; read as millions.` });
      else if (f !== 1) issues.push({ severity: 'warning', code: 'unit_converted', message: `Converted from ${unit} to ${fundCurrency} millions (× ${f}).` });
      return { factor: f, issues, blocking: false };
    }
    case 'rate':
      if (['%', 'pct', 'percent', 'percentage'].includes(lu)) return { factor: 0.01, issues, blocking: false };
      if (['fraction', 'decimal', 'ratio', 'share'].includes(lu)) return { factor: 1, issues, blocking: false };
      return { factor: 1, issues: [{ severity: 'error', code: 'unit_mismatch', message: `Unit "${unit}" is not a rate unit (use pct or fraction).` }], blocking: true };
    case 'years':
      if (['years', 'year', 'yrs', 'yr', 'y'].includes(lu)) return { factor: 1, issues, blocking: false };
      if (['months', 'month', 'mo', 'mos'].includes(lu)) return { factor: 1 / 12, issues: [{ severity: 'warning', code: 'unit_converted', message: 'Converted from months to years (÷ 12); the model rounds timings to whole years.' }], blocking: false };
      return { factor: 1, issues: [{ severity: 'error', code: 'unit_mismatch', message: `Unit "${unit}" is not a time unit (use years).` }], blocking: true };
    case 'multiple':
      if (['x', '×', 'multiple', 'times', 'ev/revenue', 'ev/rev'].includes(lu)) return { factor: 1, issues, blocking: false };
      return { factor: 1, issues: [{ severity: 'error', code: 'unit_mismatch', message: `Unit "${unit}" is not a multiple (use x).` }], blocking: true };
  }
}

export function normalizeRow(row: BenchmarkRow, fundCurrency: string): NormalizedRow {
  const { factor, issues, blocking } = unitFactor(row.baseMetric, row.unit, fundCurrency);
  const value = { low: row.low * factor, base: row.base * factor, high: row.high * factor };
  const all = [...issues];
  let usable = !blocking;
  if (!(value.low <= value.base && value.base <= value.high)) {
    all.push({ severity: 'error', code: 'range_order', message: `low ≤ base ≤ high is violated (${row.low}, ${row.base}, ${row.high}).` });
    usable = false;
  }
  const kind = METRIC_UNIT[row.baseMetric];
  if (kind === 'rate' && (value.low < 0 || value.high > 1)) {
    all.push({ severity: 'error', code: 'rate_range', message: `Rate outside 0–100% after unit conversion (check pct vs fraction).` });
    usable = false;
  }
  if ((kind === 'money' || kind === 'multiple' || kind === 'years') && value.low < 0) {
    all.push({ severity: 'error', code: 'negative', message: 'Negative value.' });
    usable = false;
  }
  return { ...row, value, factor, usable, issues: all.map((i) => ({ ...i, path: `row ${row.rowNumber}` })) };
}

// ---------------------------------------------------------------------------
// Assumptions and matching
// ---------------------------------------------------------------------------

export interface AssumptionRef {
  key: string;
  targetKind: 'profile' | 'cohort';
  targetId: string;
  targetLabel: string;
  stage: string;
  geography?: string;
  metric: BaseMetric;
  bucketId?: string;
  bucketLabel?: string;
  bucketKind?: OutcomeBucket['kind'];
  /** Current model value (model units), for the diff. */
  current: number | null;
  /** For the profile entry-valuation range. */
  currentRange?: { low: number; high: number };
}

export function assumptionKey(targetKind: string, targetId: string, metric: string, bucketId?: string) {
  return `${targetKind}:${targetId}:${metric}:${bucketId ?? ''}`;
}

/** Every assumption a benchmark row could set, for the given market profiles and strategy cohorts. */
/** Target id for a cohort assumption. Namespaced by strategy when given, because cloned strategies share cohort ids. */
export const cohortTargetId = (cohortId: string, strategyId?: string) => (strategyId ? `${strategyId}/${cohortId}` : cohortId);

export function listAssumptions(profiles: MarketProfile[], cohorts: { cohort: CohortStrategy; strategyName?: string; strategyId?: string }[]): AssumptionRef[] {
  const out: AssumptionRef[] = [];
  for (const p of profiles) {
    const base = { targetKind: 'profile' as const, targetId: p.id, targetLabel: p.label, stage: p.stage, geography: p.geography };
    if (p.rounds.length) {
      const avg = p.rounds.reduce((a, r) => a + r.size / r.postMoney, 0) / p.rounds.length;
      out.push({ ...base, key: assumptionKey('profile', p.id, 'dilution_per_round'), metric: 'dilution_per_round', current: avg });
    }
    out.push({
      ...base,
      key: assumptionKey('profile', p.id, 'entry_post_money'),
      metric: 'entry_post_money',
      current: p.entryPostMoneyRange ? (p.entryPostMoneyRange.low + p.entryPostMoneyRange.high) / 2 : null,
      currentRange: p.entryPostMoneyRange,
    });
    for (const b of p.buckets) {
      const bb = { ...base, bucketId: b.id, bucketLabel: b.label, bucketKind: b.kind };
      out.push({ ...bb, key: assumptionKey('profile', p.id, 'outcome_rate', b.id), metric: 'outcome_rate', current: b.probability });
      out.push({ ...bb, key: assumptionKey('profile', p.id, 'time_to_exit', b.id), metric: 'time_to_exit', current: b.yearsToExit });
      if (b.kind !== 'writeoff') {
        if (b.exit.mode === 'equity') out.push({ ...bb, key: assumptionKey('profile', p.id, 'exit_equity_value', b.id), metric: 'exit_equity_value', current: b.exit.equityValue });
        else out.push({ ...bb, key: assumptionKey('profile', p.id, 'exit_revenue_multiple', b.id), metric: 'exit_revenue_multiple', current: b.exit.multiple });
      }
      if (p.dilutionMode === 'quick') out.push({ ...bb, key: assumptionKey('profile', p.id, 'cumulative_dilution', b.id), metric: 'cumulative_dilution', current: b.cumulativeDilution });
    }
  }
  for (const { cohort: c, strategyName, strategyId } of cohorts) {
    const tid = cohortTargetId(c.id, strategyId);
    const base = { targetKind: 'cohort' as const, targetId: tid, targetLabel: strategyName ? `${strategyName} · ${c.label}` : c.label, stage: c.stage, geography: c.geography };
    const e = resolveEntry(c.entry);
    out.push({ ...base, key: assumptionKey('cohort', tid, 'initial_ticket'), metric: 'initial_ticket', current: e.ticket });
    out.push({ ...base, key: assumptionKey('cohort', tid, 'entry_post_money'), metric: 'entry_post_money', current: e.postMoney });
    out.push({ ...base, key: assumptionKey('cohort', tid, 'entry_ownership'), metric: 'entry_ownership', current: e.ownership });
  }
  return out;
}

const WILDCARD = new Set(['', '*', 'any', 'all', 'global']);
const norm = (s?: string) => (s ?? '').trim().toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function bucketMatches(token: string, ref: AssumptionRef): boolean {
  const t = slug(token);
  return t === slug(ref.bucketId ?? '') || t === slug(ref.bucketKind ?? '') || t === slug(ref.bucketLabel ?? '') || (t === 'writeoffs' && ref.bucketKind === 'writeoff');
}

export interface Candidate {
  row: NormalizedRow;
  /** Lexicographic: [bucket-specific, stage exact, geography, vintage]. Higher is better. */
  score: number[];
  notes: string[];
}

export interface AssumptionMatch {
  ref: AssumptionRef;
  candidates: Candidate[];
  /** Rows that would match but cannot be used (unit/currency/range errors). */
  blocked: NormalizedRow[];
  selected?: NormalizedRow;
  /** Several rows tie on the top score and the user has not chosen. */
  tie: boolean;
  tiedRowIds: string[];
  /** How the selected row was chosen, for display. */
  how: string;
  flags: Issue[];
}

export interface MatchResult {
  rows: NormalizedRow[];
  matches: AssumptionMatch[];
  unmatched: AssumptionRef[];
  ties: AssumptionMatch[];
  unusedRows: NormalizedRow[];
  issues: Issue[];
}

function candidateFor(row: NormalizedRow, ref: AssumptionRef, fundVintage: number | undefined): Candidate | null {
  if (row.baseMetric !== ref.metric) return null;
  const notes: string[] = [];
  // stage
  const rs = norm(row.stage);
  const stageExact = rs === norm(ref.stage);
  if (!stageExact && !WILDCARD.has(rs)) return null;
  if (!stageExact) notes.push('stage wildcard');
  // bucket
  let specific = 0;
  if (ref.metric === 'outcome_rate') {
    if (!row.bucket || !bucketMatches(row.bucket, ref)) return null;
    specific = 1;
  } else if (BUCKET_METRICS.includes(ref.metric)) {
    if (row.bucket) {
      if (!bucketMatches(row.bucket, ref)) return null;
      specific = 1;
    } else {
      // unsuffixed: exits/timing apply to non-write-off buckets only
      if ((ref.metric === 'time_to_exit' || ref.metric === 'exit_equity_value' || ref.metric === 'exit_revenue_multiple') && ref.bucketKind === 'writeoff') return null;
      notes.push('applies to all buckets (no bucket suffix)');
    }
  } else if (row.bucket) return null;
  // geography
  const rg = norm(row.geography);
  const tg = norm(ref.geography);
  let geo = 0;
  if (rg === tg && rg !== '') geo = 2;
  else if (WILDCARD.has(rg) || tg === '') geo = 1;
  else notes.push(`geography differs (${row.geography} vs ${ref.geography})`);
  // vintage
  let vin: number;
  if (row.vintage === null || fundVintage === undefined) {
    vin = -1000;
    if (row.vintage === null) notes.push('no vintage');
  } else {
    vin = -Math.abs(row.vintage - fundVintage);
    if (vin !== 0) notes.push(`vintage ${row.vintage} vs fund ${fundVintage}`);
  }
  return { row, score: [specific, stageExact ? 1 : 0, geo, vin], notes };
}

const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
};

/**
 * Match normalised rows to assumptions: stage (required, or wildcard), then geography, then vintage
 * (closest to the fund vintage). Bucket-specific rows beat unsuffixed rows. Equal top scores are a tie that
 * requires a user choice via `selections` (assumption key → row id).
 */
export function matchBenchmarks(
  pack: BenchmarkPack,
  refs: AssumptionRef[],
  opts: { fundCurrency: string; fundVintage?: number; selections?: Record<string, string> },
): MatchResult {
  const rows = pack.rows.map((r) => normalizeRow(r, opts.fundCurrency));
  const matches: AssumptionMatch[] = [];
  const unmatched: AssumptionRef[] = [];
  const used = new Set<string>();
  for (const ref of refs) {
    const cands: Candidate[] = [];
    const blocked: NormalizedRow[] = [];
    for (const row of rows) {
      const c = candidateFor(row, ref, opts.fundVintage);
      if (!c) continue;
      if (row.usable) cands.push(c);
      else blocked.push(row);
    }
    if (!cands.length) {
      if (blocked.length) matches.push({ ref, candidates: [], blocked, tie: false, tiedRowIds: [], how: 'only blocked rows', flags: [{ severity: 'error', code: 'only_blocked', message: `${blocked.length} matching row(s) cannot be used: ${blocked.map((b) => b.issues.find((i) => i.severity === 'error')?.message).join(' ')}` }] });
      else unmatched.push(ref);
      continue;
    }
    cands.sort((a, b) => cmp(a.score, b.score));
    const top = cands.filter((c) => cmp(c.score, cands[0].score) === 0);
    const chosenId = opts.selections?.[ref.key];
    const chosen = chosenId ? cands.find((c) => c.row.id === chosenId) : undefined;
    const tie = top.length > 1 && !chosen;
    const sel = chosen ?? (top.length === 1 ? top[0] : undefined);
    const flags: Issue[] = [];
    if (sel) {
      used.add(sel.row.id);
      for (const n of sel.notes) if (n.startsWith('geography') || n.startsWith('vintage') || n === 'no vintage') flags.push({ severity: 'warning', code: 'match_quality', message: n });
      for (const i of sel.row.issues) flags.push(i);
    }
    if (blocked.length) flags.push({ severity: 'info', code: 'blocked_rows', message: `${blocked.length} other matching row(s) excluded (unit/currency/range errors).` });
    matches.push({
      ref,
      candidates: cands,
      blocked,
      selected: sel?.row,
      tie,
      tiedRowIds: top.length > 1 ? top.map((t) => t.row.id) : [],
      how: chosen ? 'chosen by user' : sel ? describeScore(sel) : `${top.length} rows tie — choose one`,
      flags,
    });
  }
  // Entry consistency: ticket / post-money vs ownership from the selected rows, per cohort.
  const issues: Issue[] = [];
  const byCohort = new Map<string, Partial<Record<BaseMetric, NormalizedRow>>>();
  for (const m of matches)
    if (m.ref.targetKind === 'cohort' && m.selected) {
      const o = byCohort.get(m.ref.targetId) ?? {};
      o[m.ref.metric] = m.selected;
      byCohort.set(m.ref.targetId, o);
    }
  for (const [cid, o] of byCohort) {
    if (o.initial_ticket && o.entry_post_money && o.entry_ownership) {
      const iss = checkEntryConsistency(o.initial_ticket.value.base, o.entry_post_money.value.base, o.entry_ownership.value.base, `cohorts.${cid.split('/').pop()}.entry`);
      if (iss) {
        const label = matches.find((m) => m.ref.targetId === cid)?.ref.targetLabel ?? cid;
        issues.push({ ...iss, message: `${label}: benchmark ${iss.message} Ticket and post-money are applied; ownership is derived.` });
      }
    }
  }
  return { rows, matches, unmatched, ties: matches.filter((m) => m.tie), unusedRows: rows.filter((r) => r.usable && !used.has(r.id)), issues };
}

function describeScore(c: Candidate): string {
  const r = c.row;
  return `${r.stage}${r.geography ? ` / ${r.geography}` : ''}${r.vintage ? ` / ${r.vintage}` : ''}${c.score[0] ? '' : ' (unsuffixed)'}`;
}

// ---------------------------------------------------------------------------
// Case generation
// ---------------------------------------------------------------------------

export type Point = 'low' | 'base' | 'high';
export type MappingKey =
  | 'exit_equity_value'
  | 'exit_revenue_multiple'
  | 'time_to_exit'
  | 'dilution_per_round'
  | 'cumulative_dilution'
  | 'outcome_rate_writeoff'
  | 'outcome_rate_modest'
  | 'outcome_rate_strong'
  | 'outcome_rate_outlier'
  | 'outcome_rate_other';
export type CaseMapping = Record<MappingKey, { downside: Point; upside: Point }>;

/** Default: Downside uses low exit values, high dilution, high time to exit, high write-off rate; Upside mirrors. */
export const DEFAULT_CASE_MAPPING: CaseMapping = {
  exit_equity_value: { downside: 'low', upside: 'high' },
  exit_revenue_multiple: { downside: 'low', upside: 'high' },
  time_to_exit: { downside: 'high', upside: 'low' },
  dilution_per_round: { downside: 'high', upside: 'low' },
  cumulative_dilution: { downside: 'high', upside: 'low' },
  outcome_rate_writeoff: { downside: 'high', upside: 'low' },
  outcome_rate_modest: { downside: 'base', upside: 'base' },
  outcome_rate_strong: { downside: 'low', upside: 'high' },
  outcome_rate_outlier: { downside: 'low', upside: 'high' },
  outcome_rate_other: { downside: 'base', upside: 'base' },
};

export const MAPPING_LABEL: Record<MappingKey, string> = {
  exit_equity_value: 'Exit equity value',
  exit_revenue_multiple: 'Exit revenue multiple',
  time_to_exit: 'Time to exit',
  dilution_per_round: 'Dilution per round',
  cumulative_dilution: 'Cumulative dilution',
  outcome_rate_writeoff: 'Write-off rate',
  outcome_rate_modest: 'Modest-exit rate',
  outcome_rate_strong: 'Strong-exit rate',
  outcome_rate_outlier: 'Outlier rate',
  outcome_rate_other: 'Other-bucket rate',
};

export function mappingKeyFor(ref: AssumptionRef): MappingKey | null {
  if (ref.metric === 'outcome_rate') return `outcome_rate_${ref.bucketKind ?? 'other'}` as MappingKey;
  if (['exit_equity_value', 'exit_revenue_multiple', 'time_to_exit', 'dilution_per_round', 'cumulative_dilution'].includes(ref.metric)) return ref.metric as MappingKey;
  return null;
}

export type CaseKindForGen = 'downside' | 'base' | 'upside';

export function pointFor(kind: CaseKindForGen, ref: AssumptionRef, mapping: CaseMapping): Point {
  if (kind === 'base') return 'base';
  const k = mappingKeyFor(ref);
  return k ? mapping[k][kind] : 'base';
}

export function benchmarkProvenance(row: NormalizedRow, point: Point, pack: BenchmarkPack): Provenance {
  return {
    kind: 'benchmark',
    source: row.source || pack.name,
    asOf: row.asOf || 'n/a',
    unit: row.unit,
    benchmarkId: row.id,
    note: `${point} of ${row.metric} · ${row.stage}${row.geography ? `/${row.geography}` : ''}${row.vintage ? `/${row.vintage}` : ''} · ${pack.name} row ${row.rowNumber}${row.factor !== 1 ? ` · converted ×${+row.factor.toPrecision(6)}` : ''}`,
  };
}

export interface ProfileApplication {
  profile: MarketProfile;
  provenance: ProvenanceMap;
  issues: Issue[];
  /** Resulting distribution: bucket id → probability; valid if it sums to 1 with no negatives. */
  distribution: { bucketId: string; label: string; probability: number; fromBenchmark: boolean; residual: boolean }[];
  valid: boolean;
}

/** Apply selected benchmark rows to one market profile at the points chosen for a case kind. Never mutates. */
export function applyToProfile(
  profile: MarketProfile,
  matches: AssumptionMatch[],
  kind: CaseKindForGen,
  mapping: CaseMapping,
  residualBucketId: string | undefined,
  pack: BenchmarkPack,
): ProfileApplication {
  const prov: ProvenanceMap = {};
  const issues: Issue[] = [];
  let buckets = profile.buckets.map((b) => ({ ...b, exit: { ...b.exit } })) as OutcomeBucket[];
  let rounds = profile.rounds.map((r) => ({ ...r }));
  let range = profile.entryPostMoneyRange ? { ...profile.entryPostMoneyRange } : undefined;
  const residual = defaultResidualBucket(buckets, residualBucketId ?? profile.residualBucketId);
  const P = (path: string) => `profiles.${profile.id}.${path}`;
  const rateSet = new Set<string>();

  for (const m of matches) {
    if (m.ref.targetKind !== 'profile' || m.ref.targetId !== profile.id || !m.selected) continue;
    const pt = pointFor(kind, m.ref, mapping);
    const v = m.selected.value[pt];
    const pv = benchmarkProvenance(m.selected, pt, pack);
    const bi = buckets.findIndex((b) => b.id === m.ref.bucketId);
    switch (m.ref.metric) {
      case 'dilution_per_round':
        if (v > 0 && v < 1) {
          rounds = rounds.map((r) => ({ ...r, postMoney: r.size / v }));
          prov[P('rounds')] = pv;
          for (const r of rounds) prov[P(`rounds.${r.id}`)] = pv;
        } else issues.push({ severity: 'error', code: 'dilution_range', message: `${profile.label}: dilution per round ${v} must be between 0 and 1.` });
        break;
      case 'entry_post_money':
        range = { low: m.selected.value.low, high: m.selected.value.high };
        prov[P('entryPostMoneyRange')] = benchmarkProvenance(m.selected, 'low', pack);
        break;
      case 'outcome_rate':
        if (m.ref.bucketId === residual) {
          issues.push({ severity: 'info', code: 'residual_rate_ignored', message: `${profile.label}: ${m.ref.bucketLabel} is the residual bucket; its benchmark rate is not applied (it absorbs the remainder).` });
          break;
        }
        buckets[bi] = { ...buckets[bi], probability: v };
        rateSet.add(buckets[bi].id);
        prov[P(`buckets.${buckets[bi].id}.probability`)] = pv;
        break;
      case 'time_to_exit':
        buckets[bi] = { ...buckets[bi], yearsToExit: Math.max(0, Math.round(v)) };
        prov[P(`buckets.${buckets[bi].id}.yearsToExit`)] = pv;
        if (Math.abs(v - Math.round(v)) > 1e-9) issues.push({ severity: 'info', code: 'rounded_years', message: `${profile.label} / ${buckets[bi].label}: time to exit ${v.toFixed(2)} rounded to ${Math.round(v)} years.` });
        break;
      case 'exit_equity_value':
        if (buckets[bi].exit.mode === 'equity') {
          buckets[bi] = { ...buckets[bi], exit: { mode: 'equity', equityValue: v } };
          prov[P(`buckets.${buckets[bi].id}.exit`)] = pv;
        }
        break;
      case 'exit_revenue_multiple': {
        const ex = buckets[bi].exit;
        if (ex.mode === 'revenue') {
          buckets[bi] = { ...buckets[bi], exit: { ...ex, multiple: v } };
          prov[P(`buckets.${buckets[bi].id}.exit`)] = pv;
        }
        break;
      }
      case 'cumulative_dilution':
        buckets[bi] = { ...buckets[bi], cumulativeDilution: Math.min(0.999, v) };
        prov[P(`buckets.${buckets[bi].id}.cumulativeDilution`)] = pv;
        break;
      default:
        break;
    }
  }

  // Coherent probabilities: residual bucket absorbs 1 − Σ others.
  let valid = true;
  if (residual) {
    const others = buckets.filter((b) => b.id !== residual).reduce((a, b) => a + b.probability, 0);
    const r = 1 - others;
    const ri = buckets.findIndex((b) => b.id === residual);
    if (r < -1e-9) {
      valid = false;
      issues.push({ severity: 'error', code: 'residual_negative', message: `${profile.label} (${kind}): other outcome rates sum to ${(others * 100).toFixed(1)}%, so ${buckets[ri].label} would be ${(r * 100).toFixed(1)}%. Change the mapping or the residual bucket.` });
    }
    if (rateSet.size || Math.abs(buckets[ri].probability - r) > 1e-12) prov[P(`buckets.${residual}.probability`)] = { kind: 'benchmark', source: pack.name, asOf: 'n/a', unit: 'fraction', note: `residual: 1 − Σ other outcome rates (${kind})` };
    // A negative residual is kept so the preview shows it; `valid` is false and saving is blocked.
    buckets[ri] = { ...buckets[ri], probability: Math.abs(r) < 1e-12 ? 0 : r };
  }
  return {
    profile: { ...profile, buckets, rounds, entryPostMoneyRange: range, residualBucketId: residual },
    provenance: prov,
    issues,
    distribution: buckets.map((b) => ({ bucketId: b.id, label: b.label, probability: b.probability, fromBenchmark: rateSet.has(b.id), residual: b.id === residual })),
    valid,
  };
}

export interface GeneratedCases {
  cases: { kind: CaseKindForGen; marketCase: MarketCase; applications: ProfileApplication[] }[];
  valid: boolean;
  issues: Issue[];
}

/**
 * Generate Downside / Base / Upside market cases from a structural base case (bucket layout, rounds) and the
 * matched benchmark rows. Values without a benchmark match keep the base case's value and provenance.
 */
export function generateBenchmarkCases(
  baseCase: MarketCase,
  match: MatchResult,
  pack: BenchmarkPack,
  opts: { mapping?: CaseMapping; residuals?: Record<string, string>; idFor: (kind: CaseKindForGen) => string; namePrefix?: string },
): GeneratedCases {
  const mapping = opts.mapping ?? DEFAULT_CASE_MAPPING;
  const issues: Issue[] = [];
  let valid = match.ties.length === 0;
  if (!valid) issues.push({ severity: 'error', code: 'unresolved_ties', message: `${match.ties.length} assumption(s) have tied benchmark rows; choose one for each before generating.` });
  const prefix = opts.namePrefix ?? pack.name;
  const titles: Record<CaseKindForGen, string> = { downside: 'Downside', base: 'Base', upside: 'Upside' };
  const cases = (['downside', 'base', 'upside'] as CaseKindForGen[]).map((kind) => {
    const applications = baseCase.profiles.map((p) => applyToProfile(p, match.matches, kind, mapping, opts.residuals?.[p.id], pack));
    const prov: ProvenanceMap = { ...(baseCase.provenance ?? {}) };
    for (const a of applications) {
      Object.assign(prov, a.provenance);
      issues.push(...a.issues);
      if (!a.valid) valid = false;
    }
    const marketCase: MarketCase = {
      id: opts.idFor(kind),
      name: `${prefix} — ${titles[kind]}`,
      kind,
      profiles: applications.map((a) => a.profile),
      percentileBacked: pack.percentileBacked,
      note: pack.percentileBacked
        ? `Generated from ${pack.name}; the source reports low/base/high as percentiles.`
        : `Generated from ${pack.name}. An assumption bundle (${kind === 'base' ? 'base values' : 'mapped low/high values'}), not a statistical percentile.`,
      provenance: prov,
      derivedFrom: baseCase.id,
    };
    return { kind, marketCase, applications };
  });
  return { cases, valid, issues };
}

/**
 * Apply entry benchmarks (base values) to a strategy's cohorts. Sets the two inputs that benchmarks provide and
 * derives the third (ownership = ticket / post-money). Ticket + post-money take precedence when all three exist.
 */
export function applyEntryBenchmarks(strategy: Strategy, match: MatchResult, pack: BenchmarkPack): { strategy: Strategy; changed: string[]; issues: Issue[] } {
  const prov: ProvenanceMap = { ...(strategy.provenance ?? {}) };
  const changed: string[] = [];
  const issues: Issue[] = [];
  const cohorts = strategy.cohorts.map((c) => {
    const ids = new Set([c.id, cohortTargetId(c.id, strategy.id)]);
    const sel = (metric: BaseMetric) => match.matches.find((m) => m.ref.targetKind === 'cohort' && ids.has(m.ref.targetId) && m.ref.metric === metric)?.selected;
    const t = sel('initial_ticket');
    const pm = sel('entry_post_money');
    const ow = sel('entry_ownership');
    if (!t && !pm && !ow) return c;
    let derived: EntryField = c.entry.derived;
    const entry = { ...c.entry };
    const setRows: [EntryField, NormalizedRow][] = [];
    if (t && pm) {
      entry.ticket = t.value.base;
      entry.postMoney = pm.value.base;
      derived = 'ownership';
      setRows.push(['ticket', t], ['postMoney', pm]);
    } else if (t && ow) {
      entry.ticket = t.value.base;
      entry.ownership = ow.value.base;
      derived = 'postMoney';
      setRows.push(['ticket', t], ['ownership', ow]);
    } else if (pm && ow) {
      entry.postMoney = pm.value.base;
      entry.ownership = ow.value.base;
      derived = 'ticket';
      setRows.push(['postMoney', pm], ['ownership', ow]);
    } else {
      const [f, r] = t ? (['ticket', t] as const) : pm ? (['postMoney', pm] as const) : (['ownership', ow!] as const);
      entry[f] = r.value.base;
      if (derived === f) derived = f === 'ownership' ? 'postMoney' : 'ownership';
      setRows.push([f, r]);
    }
    const resolved = resolveEntry({ ...entry, derived });
    for (const [f, r] of setRows) {
      prov[`cohorts.${c.id}.entry.${f}`] = benchmarkProvenance(r, 'base', pack);
      changed.push(`cohorts.${c.id}.entry.${f}`);
    }
    prov[`cohorts.${c.id}.entry.${derived}`] = { kind: 'benchmark', source: pack.name, asOf: 'n/a', unit: derived === 'ownership' ? 'fraction' : `${strategy.fund.currency}_m`, note: `derived: ownership = ticket / post-money from benchmark inputs` };
    if (!(resolved.ownership > 0 && resolved.ownership < 1)) issues.push({ severity: 'error', code: 'ownership_range', message: `${c.label}: benchmark entry terms give ownership ${(resolved.ownership * 100).toFixed(1)}%.` });
    return { ...c, entry: resolved };
  });
  return { strategy: { ...strategy, cohorts, provenance: prov }, changed, issues };
}
