import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyEntryBenchmarks,
  BENCHMARK_CSV_TEMPLATE,
  DEFAULT_CASE_MAPPING,
  generateBenchmarkCases,
  listAssumptions,
  matchBenchmarks,
  parseBenchmarkCsv,
  parseBenchmarkJson,
  parseCsv,
  parseMetric,
  unitFactor,
} from '../benchmark';
import { evaluateFund } from '../fund';
import { resolveScenario } from '../scenario';
import * as P from '../preset';

const meta = { id: 'pk', name: 'Sample', importedAt: '2026-11-06' };
const sample = readFileSync(new URL('../../benchmarks/sample-benchmark-pack.csv', import.meta.url), 'utf8');
const pack = parseBenchmarkCsv(sample, meta);
const refs = listAssumptions(P.brightPixelBaseCase.profiles, P.brightPixelStrategy.cohorts.map((cohort) => ({ cohort })));
const fund = { fundCurrency: 'EUR', fundVintage: 2025 };
const find = (m: ReturnType<typeof matchBenchmarks>, key: string) => m.matches.find((x) => x.ref.key === key)!;

describe('parsing', () => {
  it('parses quoted CSV with commas, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  });
  it('parses metric names with bucket suffixes', () => {
    expect(parseMetric('outcome_rate_writeoff')).toEqual({ baseMetric: 'outcome_rate', bucket: 'writeoff' });
    expect(parseMetric('exit_equity_value_outlier')).toEqual({ baseMetric: 'exit_equity_value', bucket: 'outlier' });
    expect(parseMetric('time_to_exit')).toEqual({ baseMetric: 'time_to_exit' });
    expect(parseMetric('outcome_rate')).toBeNull();
    expect(parseMetric('irr_target')).toBeNull();
  });
  it('reads the sample pack, skipping # comments, with source line numbers', () => {
    expect(pack.parseIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(pack.rows.length).toBe(30);
    expect(pack.rows[0]).toMatchObject({ metric: 'initial_ticket', stage: 'seed', geography: 'europe', vintage: 2025, base: 3, rowNumber: 5 });
  });
  it('reports missing columns and bad rows', () => {
    expect(parseBenchmarkCsv('metric,stage\nx,y', meta).parseIssues[0].code).toBe('missing_columns');
    const p = parseBenchmarkCsv('metric,stage,geography,vintage,unit,low,base,high,source,as_of\nfoo,seed,,,x,1,2,3,s,d\ninitial_ticket,seed,,,EUR_m,,2,,s,d', meta);
    expect(p.rows.length).toBe(1);
    expect(p.parseIssues.map((i) => i.code)).toEqual(['unknown_metric', 'range_missing']);
  });
  it('the template parses cleanly', () => {
    const t = parseBenchmarkCsv(BENCHMARK_CSV_TEMPLATE, meta);
    expect(t.parseIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(t.rows.length).toBe(4);
  });
  it('parses JSON (array or object with rows and percentile flag)', () => {
    const rows = [{ metric: 'initial_ticket', stage: 'seed', geography: 'europe', vintage: 2025, unit: 'EUR_m', low: 2, base: 3, high: 4, source: 's', as_of: '2026' }];
    expect(parseBenchmarkJson(JSON.stringify(rows), meta).rows.length).toBe(1);
    const p = parseBenchmarkJson(JSON.stringify({ name: 'J', percentileBacked: true, rows }), meta);
    expect(p.name).toBe('J');
    expect(p.percentileBacked).toBe(true);
    expect(parseBenchmarkJson('{oops', meta).parseIssues[0].code).toBe('bad_json');
  });
});

describe('units', () => {
  it('blocks currency mismatches (no FX) and flags scale conversions', () => {
    expect(unitFactor('exit_equity_value', 'USD_m', 'EUR')).toMatchObject({ blocking: true });
    expect(unitFactor('exit_equity_value', 'USD_m', 'EUR').issues[0].code).toBe('currency_mismatch');
    const k = unitFactor('exit_equity_value', 'EUR_k', 'EUR');
    expect(k.factor).toBe(0.001);
    expect(k.issues[0].code).toBe('unit_converted');
    expect(unitFactor('initial_ticket', 'm', 'EUR').issues[0].code).toBe('currency_missing');
  });
  it('rates: pct ÷ 100, fraction as-is, others blocked', () => {
    expect(unitFactor('outcome_rate', 'pct', 'EUR').factor).toBe(0.01);
    expect(unitFactor('outcome_rate', 'fraction', 'EUR').factor).toBe(1);
    expect(unitFactor('outcome_rate', 'EUR_m', 'EUR').blocking).toBe(true);
    expect(unitFactor('time_to_exit', 'months', 'EUR').factor).toBeCloseTo(1 / 12);
  });
});

describe('matching', () => {
  const m = matchBenchmarks(pack, refs, fund);
  it('detects the tie on seed dilution per round and requires a choice', () => {
    const d = find(m, 'profile:mp-seed-eu:dilution_per_round:');
    expect(d.tie).toBe(true);
    expect(d.selected).toBeUndefined();
    expect(d.tiedRowIds).toHaveLength(2);
    expect(m.ties).toHaveLength(1);
    const chosen = matchBenchmarks(pack, refs, { ...fund, selections: { [d.ref.key]: d.tiedRowIds[1] } });
    expect(chosen.ties).toHaveLength(0);
    expect(find(chosen, d.ref.key).selected!.base).toBe(22);
  });
  it('prefers matching geography and the closest vintage; blocks USD; converts EUR_k', () => {
    const o = find(m, 'profile:mp-seed-eu:exit_equity_value:ou');
    expect(o.selected!.vintage).toBe(2025);
    expect(o.selected!.geography).toBe('europe');
    expect(o.selected!.value.base).toBeCloseTo(1200);
    expect(o.blocked.map((b) => b.unit)).toContain('USD_m');
    expect(o.flags.some((f) => f.code === 'unit_converted')).toBe(true);
    expect(o.candidates).toHaveLength(2); // 2025 and 2022 EUR rows
  });
  it('applies unsuffixed time_to_exit to non-write-off buckets only', () => {
    expect(find(m, 'profile:mp-preseed-eu:time_to_exit:mo').selected!.base).toBe(7);
    expect(m.matches.find((x) => x.ref.key === 'profile:mp-preseed-eu:time_to_exit:wo')).toBeUndefined();
    expect(m.unmatched.map((u) => u.key)).toContain('profile:mp-preseed-eu:time_to_exit:wo');
  });
  it('lists assumptions with no benchmark match', () => {
    const keys = m.unmatched.map((u) => u.key);
    expect(keys).toContain('profile:mp-seed-eu:outcome_rate:mo');
    expect(keys).toContain('profile:mp-preseed-eu:dilution_per_round:');
  });
  it('flags entry ownership disagreeing with ticket / post-money by more than 1pp', () => {
    expect(m.issues.some((i) => i.code === 'entry_inconsistent' && i.message.includes('Pre-seed'))).toBe(true);
    expect(m.issues.some((i) => i.message.includes('Ownership — Seed'))).toBe(false);
  });
});

describe('case generation', () => {
  const sel = matchBenchmarks(pack, refs, fund);
  const tieKey = sel.ties[0].ref.key;
  const m = matchBenchmarks(pack, refs, { ...fund, selections: { [tieKey]: sel.ties[0].tiedRowIds[0] } });
  const idFor = (k: string) => `mc-${k}`;
  const gen = generateBenchmarkCases(P.brightPixelBaseCase, m, pack, { idFor });

  it('refuses to generate while ties are unresolved', () => {
    expect(generateBenchmarkCases(P.brightPixelBaseCase, sel, pack, { idFor }).valid).toBe(false);
  });
  it('produces Downside/Base/Upside with coherent probabilities (residual = modest)', () => {
    expect(gen.valid).toBe(true);
    const seed = (k: number) => gen.cases[k].marketCase.profiles.find((p) => p.id === 'mp-seed-eu')!;
    const probs = (k: number) => Object.fromEntries(seed(k).buckets.map((b) => [b.id, +b.probability.toFixed(6)]));
    expect(probs(0)).toEqual({ wo: 0.6, mo: 0.27, st: 0.1, ou: 0.03 }); // 1 − .60 − .10 − .03
    expect(probs(1)).toEqual({ wo: 0.5, mo: 0.3, st: 0.15, ou: 0.05 });
    expect(probs(2)).toEqual({ wo: 0.42, mo: 0.33, st: 0.18, ou: 0.07 });
  });
  it('maps low/high per metric: downside low exits, high dilution, later exits', () => {
    const seed = (k: number) => gen.cases[k].marketCase.profiles.find((p) => p.id === 'mp-seed-eu')!;
    const ou = (k: number) => seed(k).buckets.find((b) => b.id === 'ou')!;
    expect(ou(0).exit).toEqual({ mode: 'equity', equityValue: 700 });
    expect(ou(2).exit).toEqual({ mode: 'equity', equityValue: 2000 });
    expect(ou(0).yearsToExit).toBe(9);
    expect(ou(2).yearsToExit).toBe(7);
    expect(seed(0).rounds[0].size / seed(0).rounds[0].postMoney).toBeCloseTo(0.28);
    expect(seed(2).rounds[0].size / seed(2).rounds[0].postMoney).toBeCloseTo(0.15);
    expect(seed(1).entryPostMoneyRange).toEqual({ low: 10, high: 22 });
  });
  it('records benchmark provenance; unmatched values keep base-case provenance', () => {
    const prov = gen.cases[0].marketCase.provenance!;
    expect(prov['profiles.mp-seed-eu.buckets.ou.exit']).toMatchObject({ kind: 'benchmark', source: 'Illustrative sample', asOf: '2026-06-30', unit: 'EUR_k' });
    expect(prov['profiles.mp-seed-eu.buckets.mo.probability']).toMatchObject({ note: expect.stringMatching(/residual/) });
    expect(prov['profiles.mp-seed-eu.buckets.mo.roundsReached']).toMatchObject({ kind: 'demo' });
  });
  it('labels cases as assumption bundles unless the pack is percentile-backed', () => {
    expect(gen.cases[0].marketCase.percentileBacked).toBe(false);
    expect(gen.cases[0].marketCase.note).toMatch(/not a statistical percentile/);
    const pg = generateBenchmarkCases(P.brightPixelBaseCase, m, { ...pack, percentileBacked: true }, { idFor });
    expect(pg.cases[0].marketCase.percentileBacked).toBe(true);
  });
  it('blocks saving when the residual bucket would go negative', () => {
    // Residual = outlier. Downside with write-off high (.60), strong high (.18) and modest kept at .30 (no
    // benchmark row) sums to 1.08, so the outlier residual would be −8%.
    const mapping = { ...DEFAULT_CASE_MAPPING, outcome_rate_strong: { downside: 'high' as const, upside: 'high' as const } };
    const fail = generateBenchmarkCases(P.brightPixelBaseCase, m, pack, { idFor, residuals: { 'mp-seed-eu': 'ou' }, mapping });
    expect(fail.valid).toBe(false);
    const d = fail.cases[0].applications.find((x) => x.profile.id === 'mp-seed-eu')!.distribution.find((x) => x.bucketId === 'ou')!;
    expect(d.probability).toBeCloseTo(-0.08);
    expect(fail.issues.some((i) => i.code === 'residual_negative')).toBe(true);
  });
  it('generated cases evaluate and order Downside < Base < Upside', () => {
    const moic = (k: number) => evaluateFund(resolveScenario(P.brightPixelStrategy, gen.cases[k].marketCase).model).gross.moic!;
    expect(moic(0)).toBeLessThan(moic(1));
    expect(moic(1)).toBeLessThan(moic(2));
  });
  it('applies entry benchmarks: ticket + post-money set, ownership derived, provenance recorded', () => {
    const { strategy, changed } = applyEntryBenchmarks(P.brightPixelStrategy, m, pack);
    const pre = strategy.cohorts.find((c) => c.id === 'co-exploration')!;
    expect(pre.entry).toMatchObject({ ticket: 2, postMoney: 12, derived: 'ownership' });
    expect(pre.entry.ownership).toBeCloseTo(2 / 12);
    expect(changed).toContain('cohorts.co-exploration.entry.ticket');
    expect(strategy.provenance!['cohorts.co-exploration.entry.postMoney']).toMatchObject({ kind: 'benchmark' });
    expect(P.brightPixelStrategy.provenance!['cohorts.co-exploration.entry.postMoney']).toMatchObject({ kind: 'demo' }); // not mutated
  });
});
