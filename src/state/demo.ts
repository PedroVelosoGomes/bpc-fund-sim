import { presets, type Scenario } from '../../engine';
import { WORKSPACE_SCHEMA_VERSION, type Workspace } from './workspace';

/** Illustrative demo workspace: two strategies × the demo Downside/Base/Upside cases. All values are demo data. */
export function demoWorkspace(): Workspace {
  const cases = presets.demoMarketCases();
  const [down, base] = cases;
  const strategies = [presets.brightPixelStrategy, presets.concentratedStrategy];
  const sc = (id: string, name: string, strategyId: string, marketCaseId: string): Scenario => ({
    id,
    name,
    strategyId,
    marketCaseId,
    cohortOverrides: {},
    provenance: {},
    origin: 'demo',
    createdAt: new Date().toISOString(),
  });
  // Each scenario gets its own strategy copy so edits never leak between scenarios.
  const own = (sid: string, s: (typeof strategies)[number]) => ({ ...structuredClone(s), id: `${s.id}--${sid}` });
  const defs = [
    ['sc-balanced-base', 'Balanced × Base', strategies[0], base.id],
    ['sc-concentrated-base', 'Concentrated × Base', strategies[1], base.id],
    ['sc-balanced-downside', 'Balanced × Downside', strategies[0], down.id],
  ] as const;
  const ws: Workspace = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    strategies: {},
    marketCases: Object.fromEntries(cases.map((c) => [c.id, c])),
    scenarios: {},
    benchmarks: {},
    scenarioOrder: [],
    dataLabel: 'illustrative demo data',
    updatedAt: new Date().toISOString(),
  };
  for (const [id, name, strat, mc] of defs) {
    const s = own(id, strat);
    ws.strategies[s.id] = s;
    ws.scenarios[id] = sc(id, name, s.id, mc);
    ws.scenarioOrder.push(id);
  }
  return ws;
}
