import { evaluateFund, provenanceFor, resolveScenario, type FundModel, type FundResult, type Issue, type MarketCase, type Provenance, type Scenario, type Strategy } from '../../engine';
import { useStore } from './store';

export interface ScenarioBundle {
  scenario: Scenario;
  strategy: Strategy;
  marketCase: MarketCase;
  model: FundModel;
  result: FundResult;
  resolveIssues: Issue[];
  prov: (path: string) => Provenance | undefined;
}

// Memoise by object identity: the store replaces objects on every edit, so identity is a correct cache key.
const cache = new WeakMap<Scenario, { strategy: Strategy; marketCase: MarketCase; bundle: ScenarioBundle }>();

export function bundleFor(scenario: Scenario | undefined, strategy: Strategy | undefined, marketCase: MarketCase | undefined): ScenarioBundle | undefined {
  if (!scenario || !strategy || !marketCase) return undefined;
  const hit = cache.get(scenario);
  if (hit && hit.strategy === strategy && hit.marketCase === marketCase) return hit.bundle;
  const { model, issues } = resolveScenario(strategy, marketCase, scenario.cohortOverrides);
  const result = evaluateFund(model);
  const bundle: ScenarioBundle = { scenario, strategy, marketCase, model, result, resolveIssues: issues, prov: (p) => provenanceFor(scenario, strategy, marketCase, p) };
  cache.set(scenario, { strategy, marketCase, bundle });
  return bundle;
}

export function useBundle(id: string | undefined): ScenarioBundle | undefined {
  const scenario = useStore((s) => (id ? s.ws.scenarios[id] : undefined));
  const strategy = useStore((s) => (scenario ? s.ws.strategies[scenario.strategyId] : undefined));
  const marketCase = useStore((s) => (scenario ? s.ws.marketCases[scenario.marketCaseId] : undefined));
  return bundleFor(scenario, strategy, marketCase);
}

export function useBundles(ids: string[]): ScenarioBundle[] {
  const ws = useStore((s) => s.ws);
  return ids.map((id) => {
    const sc = ws.scenarios[id];
    return bundleFor(sc, sc && ws.strategies[sc.strategyId], sc && ws.marketCases[sc.marketCaseId]);
  }).filter((b): b is ScenarioBundle => !!b);
}
