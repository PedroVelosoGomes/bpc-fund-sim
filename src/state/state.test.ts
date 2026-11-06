import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { bundleFor } from './results';
import { migrate } from './persistence';
import { WORKSPACE_SCHEMA_VERSION } from './workspace';
import { demoWorkspace } from './demo';
import { readFileSync } from 'node:fs';
import { applyEntryBenchmarks, generateBenchmarkCases, listAssumptions, matchBenchmarks, parseBenchmarkCsv } from '../../engine';

const S = () => useStore.getState();
const bundle = (id: string) => {
  const ws = S().ws;
  const sc = ws.scenarios[id];
  return bundleFor(sc, ws.strategies[sc.strategyId], ws.marketCases[sc.marketCaseId])!;
};

describe('workspace store', () => {
  beforeEach(() => S().loadDemo());

  it('loads the demo with three scenarios compared and Downside/Base/Upside cases', () => {
    expect(S().ws.scenarioOrder).toHaveLength(3);
    expect(S().ui.compareIds).toHaveLength(3);
    expect(Object.values(S().ws.marketCases).map((m) => m.kind).sort()).toEqual(['base', 'downside', 'upside']);
    expect(S().ws.dataLabel).toBe('illustrative demo data');
  });

  it('clone creates an independent copy; editing it never modifies the original', () => {
    const orig = S().ws.scenarioOrder[0];
    const before = bundle(orig).result.gross.moic;
    const clone = S().cloneScenario(orig)!;
    expect(S().ws.scenarios[clone].strategyId).not.toBe(S().ws.scenarios[orig].strategyId);
    S().editStrategy(clone, (s) => (s.cohorts[0].entry = { ...s.cohorts[0].entry, ticket: 3.5, ownership: 3.5 / 15 }), ['cohorts.co-ownership.entry.ticket']);
    expect(bundle(orig).result.gross.moic).toBe(before);
    expect(bundle(clone).result.gross.moic).not.toBe(before);
    expect(bundle(clone).prov('cohorts.co-ownership.entry.ticket')?.kind).toBe('user');
    expect(bundle(orig).prov('cohorts.co-ownership.entry.ticket')?.kind).toBe('demo');
  });

  it('switches several scenarios to the same market case in one call', () => {
    const ids = S().ui.compareIds;
    const down = Object.values(S().ws.marketCases).find((m) => m.kind === 'downside')!.id;
    S().setMarketCase(ids, down);
    expect(ids.every((id) => S().ws.scenarios[id].marketCaseId === down)).toBe(true);
  });

  it('bucket overrides stay on the scenario and record user provenance; revert restores the case', () => {
    const id = S().ws.scenarioOrder[0];
    const b0 = bundle(id);
    const buckets = b0.model.cohorts[0].buckets.map((b) => (b.kind === 'outlier' ? { ...b, exit: { mode: 'equity' as const, equityValue: 2400 } } : b));
    S().setCohortOverride(id, 'co-ownership', { buckets }, ['cohorts.co-ownership.buckets.ou.exit']);
    const b1 = bundle(id);
    expect(b1.result.gross.moic!).toBeGreaterThan(b0.result.gross.moic!);
    expect(b1.prov('cohorts.co-ownership.buckets.ou.exit')?.kind).toBe('user');
    // shared market case untouched
    const mc = S().ws.marketCases[S().ws.scenarios[id].marketCaseId];
    expect(mc.profiles.find((p) => p.id === 'mp-seed-eu')!.buckets.find((b) => b.id === 'ou')!.exit).toEqual({ mode: 'equity', equityValue: 1200 });
    S().setCohortOverride(id, 'co-ownership', null, []);
    expect(bundle(id).result.gross.moic).toBeCloseTo(b0.result.gross.moic!, 12);
  });

  it('compare is capped at three scenarios', () => {
    const extra = S().cloneScenario(S().ws.scenarioOrder[0])!;
    expect(S().ui.compareIds).not.toContain(extra);
    S().toggleCompare(extra);
    expect(S().ui.compareIds).toHaveLength(3);
  });

  it('copy-on-write: editing one scenario keeps other scenarios’ cached results', () => {
    const [a, c] = [S().ws.scenarioOrder[0], S().ws.scenarioOrder[1]];
    const rc = bundle(c);
    S().editStrategy(a, (s) => (s.cohorts[0].companyCount = 10), []);
    expect(bundle(c)).toBe(rc);
  });

  it('deleting a scenario removes its strategy and drops it from compare', () => {
    const id = S().ws.scenarioOrder[0];
    const st = S().ws.scenarios[id].strategyId;
    S().deleteScenario(id);
    expect(S().ws.scenarios[id]).toBeUndefined();
    expect(S().ws.strategies[st]).toBeUndefined();
    expect(S().ui.compareIds).not.toContain(id);
  });
});

describe('benchmark generation in the workspace', () => {
  beforeEach(() => S().loadDemo());
  it('saves cases, applies entry values to the target strategy only, creates three compared scenarios', () => {
    const csv = readFileSync(new URL('../../benchmarks/sample-benchmark-pack.csv', import.meta.url), 'utf8');
    const pack = parseBenchmarkCsv(csv, { id: 'pk', name: 'Sample', importedAt: 'x' });
    S().addBenchmarkPack(pack);
    const ws = S().ws;
    const [target, other] = ws.scenarioOrder;
    const st = ws.strategies[ws.scenarios[target].strategyId];
    const otherStrat = ws.strategies[ws.scenarios[other].strategyId];
    const base = Object.values(ws.marketCases).find((m) => m.kind === 'base')!;
    const refs = listAssumptions(base.profiles, st.cohorts.map((cohort) => ({ cohort, strategyId: st.id })));
    const first = matchBenchmarks(pack, refs, { fundCurrency: 'EUR', fundVintage: 2025 });
    const m = matchBenchmarks(pack, refs, { fundCurrency: 'EUR', fundVintage: 2025, selections: { [first.ties[0].ref.key]: first.ties[0].tiedRowIds[0] } });
    const gen = generateBenchmarkCases(base, m, pack, { idFor: (k) => `mc-${k}` });
    const upd = applyEntryBenchmarks(st, m, pack);
    const created = S().saveBenchmarkCases({ cases: gen.cases.map((c) => c.marketCase), strategyUpdates: [{ scenarioId: target, strategy: upd.strategy }], createFromScenarioId: target });
    expect(created).toHaveLength(3);
    expect(S().ui.compareIds).toEqual(created);
    expect(S().ws.dataLabel).toBe('benchmark pack');
    expect(S().ws.benchmarks.pk.rows).toHaveLength(30);
    const after = S().ws;
    expect(after.strategies[after.scenarios[target].strategyId].provenance!['cohorts.co-exploration.entry.ticket']).toMatchObject({ kind: 'benchmark' });
    expect(after.strategies[after.scenarios[other].strategyId]).toBe(otherStrat);
    expect(created.map((id) => after.marketCases[after.scenarios[id].marketCaseId].kind)).toEqual(['downside', 'base', 'upside']);
    const moics = created.map((id) => bundle(id).result.gross.moic!);
    expect(moics[0]).toBeLessThan(moics[1]);
    expect(moics[1]).toBeLessThan(moics[2]);
  });
});

describe('persistence migrations', () => {
  const current = () => ({ schemaVersion: WORKSPACE_SCHEMA_VERSION, workspace: demoWorkspace(), ui: { compareIds: [], theme: 'system' as const } });
  it('accepts a current-version state', () => {
    expect(migrate(JSON.parse(JSON.stringify(current()))).state).not.toBeNull();
  });
  it('migrates an unversioned (v0) state', () => {
    const { schemaVersion, ui, ...rest } = current();
    const { dataLabel, scenarioOrder, ...ws } = rest.workspace;
    const res = migrate(JSON.parse(JSON.stringify({ workspace: ws })));
    expect(res.state?.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(res.state?.workspace.scenarioOrder).toHaveLength(3);
    expect(res.migratedFrom).toBe(0);
  });
  it('migrates v1 → v2 by adding an empty benchmark store', () => {
    const { benchmarks, ...wsNoBench } = current().workspace;
    const v1 = JSON.parse(JSON.stringify({ schemaVersion: 1, workspace: { ...wsNoBench, schemaVersion: 1 }, ui: { compareIds: [], theme: 'system' } }));
    const res = migrate(v1);
    expect(res.state?.workspace.benchmarks).toEqual({});
    expect(res.migratedFrom).toBe(1);
  });
  it('refuses newer versions and invalid data with a reason', () => {
    expect(migrate({ ...current(), schemaVersion: 99 }).error).toMatch(/newer/);
    const bad = JSON.parse(JSON.stringify(current()));
    bad.workspace.strategies[Object.keys(bad.workspace.strategies)[0]].fund.committedCapital = 'lots';
    expect(migrate(bad).state).toBeNull();
  });
});
