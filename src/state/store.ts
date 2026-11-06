import { create } from 'zustand';
import type { BenchmarkPack, CohortMarketOverride, CohortStrategy, MarketCase, Provenance, Scenario, Strategy } from '../../engine';
import { demoWorkspace } from './demo';
import { clearState, loadState, saveState } from './persistence';
import { emptyWorkspace, WORKSPACE_SCHEMA_VERSION, type UiPrefs, type Workspace } from './workspace';

export type MetricKey =
  | 'committed'
  | 'paidIn'
  | 'invested'
  | 'fees'
  | 'investable'
  | 'reserveUsed'
  | 'unusedCapacity'
  | 'overAllocation'
  | 'grossProceeds'
  | 'grossMoic'
  | 'grossIrr'
  | 'netMultiple'
  | 'netIrr'
  | 'gpCarry'
  | 'outlierShare'
  | 'timeToFirstDistribution';

export type Drill =
  | { kind: 'metric'; scenarioId: string; metric: MetricKey }
  | { kind: 'cohort'; scenarioId: string; cohortId: string }
  | { kind: 'bucket'; scenarioId: string; cohortId: string; bucketId: string }
  | { kind: 'year'; scenarioId: string; year: number }
  | { kind: 'issues'; scenarioId: string };

export type CenterTab = 'compare' | 'cashflows' | 'proceeds' | 'reserve' | 'sensitivity' | 'benchmarks';

interface State {
  ready: boolean;
  loadError?: string;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  ws: Workspace;
  ui: UiPrefs;
  drill: Drill | null;
  centerTab: CenterTab;

  init(): Promise<void>;
  loadDemo(): void;
  resetWorkspace(): Promise<void>;
  setTheme(t: UiPrefs['theme']): void;
  focus(id: string): void;
  toggleCompare(id: string): void;
  setDrill(d: Drill | null): void;
  setCenterTab(t: CenterTab): void;

  cloneScenario(id: string): string | undefined;
  deleteScenario(id: string): void;
  renameScenario(id: string, name: string): void;
  setMarketCase(scenarioIds: string[], marketCaseId: string): void;
  /** Edit the scenario's strategy. `paths` are provenance paths to mark as user overrides. */
  editStrategy(scenarioId: string, fn: (s: Strategy) => void, paths: string[]): void;
  setCohortOverride(scenarioId: string, cohortId: string, override: CohortMarketOverride | null, paths: string[]): void;
  addCohort(scenarioId: string): void;
  addBenchmarkPack(pack: BenchmarkPack): void;
  deleteBenchmarkPack(id: string): void;
  /** Save generated market cases; optionally apply entry benchmarks to strategies and create scenarios. */
  saveBenchmarkCases(args: {
    cases: MarketCase[];
    strategyUpdates: { scenarioId: string; strategy: Strategy }[];
    createFromScenarioId?: string;
  }): string[];
  /** Benchmark wizard: which pack is open (UI only, not persisted). */
  activePackId?: string;
  setActivePack(id: string | undefined): void;
  removeCohort(scenarioId: string, cohortId: string): void;
}

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const now = () => new Date().toISOString();

function userProv(previous?: Provenance): Provenance {
  return previous && previous.kind !== 'user' ? { kind: 'user', at: now(), previous } : { kind: 'user', at: now(), previous: previous?.kind === 'user' ? previous.previous : undefined };
}

export const useStore = create<State>((set, get) => {
  /** Copy-on-write edit: only entities accessed through `scenario()` / `strategy()` get new identities. */
  const touch = (fn: (d: { ws: Workspace; scenario(id: string): Scenario | undefined; strategy(id: string): Strategy | undefined }) => void) => {
    const cur = get().ws;
    const ws: Workspace = { ...cur, strategies: { ...cur.strategies }, scenarios: { ...cur.scenarios }, marketCases: { ...cur.marketCases }, scenarioOrder: [...cur.scenarioOrder] };
    const doneSc = new Set<string>();
    const doneSt = new Set<string>();
    fn({
      ws,
      scenario(id) {
        if (ws.scenarios[id] && !doneSc.has(id)) {
          ws.scenarios[id] = structuredClone(ws.scenarios[id]);
          doneSc.add(id);
        }
        return ws.scenarios[id];
      },
      strategy(id) {
        if (ws.strategies[id] && !doneSt.has(id)) {
          ws.strategies[id] = structuredClone(ws.strategies[id]);
          doneSt.add(id);
        }
        return ws.strategies[id];
      },
    });
    ws.updatedAt = now();
    set({ ws });
  };

  return {
    ready: false,
    saveState: 'idle',
    ws: emptyWorkspace(),
    ui: { compareIds: [], theme: 'system' },
    drill: null,
    centerTab: 'compare',

    async init() {
      const { state, error } = await loadState();
      if (state) set({ ws: state.workspace, ui: state.ui, ready: true, loadError: error });
      else set({ ready: true, loadError: error });
    },
    loadDemo() {
      const ws = demoWorkspace();
      set({ ws, ui: { ...get().ui, focusedId: ws.scenarioOrder[0], compareIds: ws.scenarioOrder.slice(0, 3) }, drill: null });
    },
    async resetWorkspace() {
      await clearState();
      set({ ws: emptyWorkspace(), ui: { compareIds: [], theme: get().ui.theme }, drill: null });
    },
    setTheme(theme) {
      set({ ui: { ...get().ui, theme } });
    },
    focus(id) {
      set({ ui: { ...get().ui, focusedId: id } });
    },
    toggleCompare(id) {
      const cur = get().ui.compareIds;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id];
      set({ ui: { ...get().ui, compareIds: next } });
    },
    setDrill(drill) {
      set({ drill });
    },
    setCenterTab(centerTab) {
      set({ centerTab });
    },

    cloneScenario(id) {
      const src = get().ws.scenarios[id];
      if (!src) return;
      const newId = uid('sc');
      touch(({ ws }) => {
        const strat = structuredClone(ws.strategies[src.strategyId]);
        strat.id = uid('st');
        ws.strategies[strat.id] = strat;
        const sc: Scenario = { ...structuredClone(src), id: newId, name: `${src.name} (copy)`, strategyId: strat.id, parentId: src.id, origin: 'clone', createdAt: now() };
        ws.scenarios[newId] = sc;
        const idx = ws.scenarioOrder.indexOf(id);
        ws.scenarioOrder.splice(idx + 1, 0, newId);
      });
      const ui = get().ui;
      set({ ui: { ...ui, focusedId: newId, compareIds: ui.compareIds.length < 3 ? [...ui.compareIds, newId] : ui.compareIds } });
      return newId;
    },
    deleteScenario(id) {
      touch(({ ws }) => {
        const sc = ws.scenarios[id];
        if (!sc) return;
        delete ws.scenarios[id];
        ws.scenarioOrder = ws.scenarioOrder.filter((x) => x !== id);
        if (!Object.values(ws.scenarios).some((s) => s.strategyId === sc.strategyId)) delete ws.strategies[sc.strategyId];
      });
      const ui = get().ui;
      const order = get().ws.scenarioOrder;
      set({ ui: { ...ui, compareIds: ui.compareIds.filter((x) => x !== id), focusedId: ui.focusedId === id ? order[0] : ui.focusedId }, drill: get().drill && 'scenarioId' in get().drill! && get().drill!.scenarioId === id ? null : get().drill });
    },
    renameScenario(id, name) {
      touch((d) => {
        const sc = d.scenario(id);
        if (sc) sc.name = name;
      });
    },
    setMarketCase(ids, marketCaseId) {
      touch((d) => {
        for (const id of ids) {
          const sc = d.scenario(id);
          if (sc) sc.marketCaseId = marketCaseId;
        }
      });
    },
    editStrategy(scenarioId, fn, paths) {
      touch((d) => {
        const sc = d.ws.scenarios[scenarioId];
        const st = sc && d.strategy(sc.strategyId);
        if (!st) return;
        fn(st);
        st.provenance = st.provenance ?? {};
        for (const p of paths) st.provenance[p] = userProv(st.provenance[p]);
      });
    },
    setCohortOverride(scenarioId, cohortId, override, paths) {
      touch((d) => {
        const sc = d.scenario(scenarioId);
        if (!sc) return;
        if (override === null) {
          delete sc.cohortOverrides[cohortId];
          for (const k of Object.keys(sc.provenance)) if (k.startsWith(`cohorts.${cohortId}.`)) delete sc.provenance[k];
          return;
        }
        sc.cohortOverrides[cohortId] = { ...sc.cohortOverrides[cohortId], ...override };
        for (const p of paths) sc.provenance[p] = userProv(sc.provenance[p]);
      });
    },
    addCohort(scenarioId) {
      const sc = get().ws.scenarios[scenarioId];
      const st = sc && get().ws.strategies[sc.strategyId];
      const mc = sc && get().ws.marketCases[sc.marketCaseId];
      if (!st || !mc) return;
      const prof = mc.profiles[0];
      const id = uid('co');
      const cohort: CohortStrategy = {
        id,
        label: 'New cohort',
        stage: prof?.stage ?? 'seed',
        geography: prof?.geography,
        sleeveId: st.fund.sleeves.find((s) => s.use === 'direct')?.id,
        companyCount: 5,
        deployment: { mode: 'single', entryYear: 0 },
        entry: { ticket: 2, postMoney: 10, ownership: 0.2, derived: 'ownership' },
        followOn: { kind: 'none' },
        marketProfileId: prof?.id ?? '',
      };
      get().editStrategy(scenarioId, (s) => s.cohorts.push(cohort), [`cohorts.${id}.companyCount`, `cohorts.${id}.entry.ticket`, `cohorts.${id}.entry.postMoney`]);
    },
    addBenchmarkPack(pack) {
      touch(({ ws }) => {
        ws.benchmarks = { ...ws.benchmarks, [pack.id]: pack };
      });
      set({ activePackId: pack.id });
    },
    deleteBenchmarkPack(id) {
      touch(({ ws }) => {
        const next = { ...ws.benchmarks };
        delete next[id];
        ws.benchmarks = next;
      });
      if (get().activePackId === id) set({ activePackId: undefined });
    },
    setActivePack(id) {
      set({ activePackId: id });
    },
    saveBenchmarkCases({ cases, strategyUpdates, createFromScenarioId }) {
      const created: string[] = [];
      touch((d) => {
        for (const c of cases) d.ws.marketCases[c.id] = c;
        for (const u of strategyUpdates) {
          const sc = d.ws.scenarios[u.scenarioId];
          if (sc) d.ws.strategies[sc.strategyId] = { ...u.strategy, id: sc.strategyId };
        }
        const src = createFromScenarioId ? d.ws.scenarios[createFromScenarioId] : undefined;
        if (src) {
          const baseStrat = d.ws.strategies[src.strategyId];
          const title = { downside: 'Downside', base: 'Base', upside: 'Upside', custom: 'Custom' } as const;
          let at = d.ws.scenarioOrder.indexOf(src.id) + 1;
          for (const c of cases) {
            const st = structuredClone(baseStrat);
            st.id = uid('st');
            d.ws.strategies[st.id] = st;
            const id = uid('sc');
            d.ws.scenarios[id] = {
              id,
              name: `${baseStrat.name.replace(/ \(demo\)$/, '')} × ${c.name}`,
              strategyId: st.id,
              marketCaseId: c.id,
              cohortOverrides: {},
              provenance: {},
              parentId: src.id,
              origin: 'generated',
              createdAt: now(),
              notes: `${title[c.kind]} case generated from a benchmark pack.`,
            };
            d.ws.scenarioOrder.splice(at++, 0, id);
            created.push(id);
          }
        }
        d.ws.dataLabel = 'benchmark pack';
      });
      if (created.length) set({ ui: { ...get().ui, focusedId: created[1] ?? created[0], compareIds: created.slice(0, 3) }, centerTab: 'compare', drill: null });
      return created;
    },
    removeCohort(scenarioId, cohortId) {
      get().editStrategy(scenarioId, (s) => (s.cohorts = s.cohorts.filter((c) => c.id !== cohortId)), []);
      get().setCohortOverride(scenarioId, cohortId, null, []);
    },
  };
});

// ---- Persistence: debounced save of workspace + UI prefs whenever they change (after init).
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (!s.ready || (s.ws === prev.ws && s.ui === prev.ui)) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    useStore.setState({ saveState: 'saving' });
    try {
      const { ws, ui } = useStore.getState();
      await saveState({ schemaVersion: WORKSPACE_SCHEMA_VERSION, workspace: ws, ui });
      useStore.setState({ saveState: 'saved' });
    } catch {
      useStore.setState({ saveState: 'error' });
    }
  }, 300);
});
