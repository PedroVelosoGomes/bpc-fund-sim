import { useEffect } from 'react';
import { useStore, type CenterTab } from './state/store';
import { useBundle, useBundles } from './state/results';
import { useResolvedTheme } from './lib/theme';
import { ScenarioList } from './components/ScenarioList';
import { FundEditor } from './components/editor/FundEditor';
import { CohortsEditor } from './components/editor/CohortEditor';
import { Comparison } from './components/center/Comparison';
import { AnnualChart, JCurveChart, ProceedsChart, ReserveView } from './components/center/Charts';
import { Sensitivity } from './components/center/Sensitivity';
import { DrillPanel } from './components/drill/DrillPanel';
import { TooltipLayer } from './components/Tooltip';
import { Select, TextField } from './components/fields';

export function App() {
  const ready = useStore((s) => s.ready);
  const ws = useStore((s) => s.ws);
  const theme = useResolvedTheme();
  useEffect(() => {
    useStore.getState().init();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (!ready) return <div className="loading">Loading workspace…</div>;
  return (
    <>
      <Header />
      {ws.scenarioOrder.length === 0 ? <Welcome /> : <Workspace />}
      <TooltipLayer />
    </>
  );
}

function Header() {
  const ws = useStore((s) => s.ws);
  const save = useStore((s) => s.saveState);
  const pref = useStore((s) => s.ui.theme);
  const loadError = useStore((s) => s.loadError);
  const { setTheme, resetWorkspace } = useStore.getState();
  return (
    <header className="app-header">
      <strong>Bright Pixel Capital</strong>
      <span className="muted">Fund simulator</span>
      {ws.dataLabel !== 'empty' && <span className={`badge ${ws.dataLabel === 'illustrative demo data' ? 'demo' : 'bench'}`} data-tip="Source of the workspace's market assumptions">{ws.dataLabel}</span>}
      <span className="spacer" />
      {loadError && <span className="bad small" data-tip={loadError}>Saved workspace could not be read (backup kept)</span>}
      <span className="muted small" data-tip="Saved locally in this browser (IndexedDB)">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved locally' : save === 'error' ? 'Save failed' : ''}</span>
      <Select value={pref} options={[{ value: 'system', label: 'Theme: system' }, { value: 'light', label: 'Theme: light' }, { value: 'dark', label: 'Theme: dark' }]} onChange={setTheme} />
      {ws.scenarioOrder.length > 0 && (
        <button className="small" onClick={() => confirm('Reset the workspace? All scenarios and edits in this browser will be deleted.') && resetWorkspace()}>Reset workspace</button>
      )}
    </header>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <h1>Start a workspace</h1>
      <div className="welcome-options">
        <div className="card">
          <h3>Illustrative demo data</h3>
          <p className="muted">Bright Pixel demo preset: €250M fund, Ownership / Exploration / Ecosystem sleeves, Balanced and Concentrated strategies under demo Downside, Base and Upside cases. Every market value is labelled <span className="badge demo">demo data</span>.</p>
          <button className="primary" onClick={() => useStore.getState().loadDemo()}>Load demo data</button>
        </div>
        <div className="card disabled">
          <h3>Benchmark pack</h3>
          <p className="muted">Import a CSV / JSON benchmark pack and generate Downside, Base and Upside cases from it.</p>
          <button disabled>Available in phase 3</button>
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const ui = useStore((s) => s.ui);
  const tab = useStore((s) => s.centerTab);
  const setTab = useStore((s) => s.setCenterTab);
  const compared = useBundles(ui.compareIds);
  const focused = useBundle(ui.focusedId);
  const tabs: { id: CenterTab; label: string }[] = [
    { id: 'compare', label: 'Compare' },
    { id: 'cashflows', label: 'Cash flows' },
    { id: 'proceeds', label: 'Proceeds' },
    { id: 'reserve', label: 'Reserve' },
    { id: 'sensitivity', label: 'Sensitivity' },
  ];
  return (
    <main className="layout">
      <aside className="left">
        <ScenarioList />
        {focused && <ScenarioEditor />}
      </aside>
      <section className="center">
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
          <span className="spacer" />
          <span className="muted small" data-tip="Deterministic expected-value model. The IRR of expected cash flows is not the average IRR of simulated paths.">expected cash-flow case ⓘ</span>
        </nav>
        <div className="center-body">
          {tab === 'compare' && (
            <>
              <Comparison bundles={compared} />
              {compared.length > 0 && <JCurveChart bundles={compared} />}
            </>
          )}
          {tab === 'cashflows' && (focused ? <><AnnualChart b={focused} /><JCurveChart bundles={[focused]} /></> : <Empty />)}
          {tab === 'proceeds' && (compared.length ? <ProceedsChart bundles={compared} /> : <Empty />)}
          {tab === 'reserve' && (focused ? <ReserveView b={focused} /> : <Empty />)}
          {tab === 'sensitivity' && (focused ? <Sensitivity b={focused} /> : <Empty />)}
        </div>
      </section>
      <aside className="right">
        <DrillPanel />
      </aside>
    </main>
  );
}

const Empty = () => <div className="empty">Select a scenario.</div>;

function ScenarioEditor() {
  const id = useStore((s) => s.ui.focusedId)!;
  const b = useBundle(id)!;
  const ws = useStore((s) => s.ws);
  const { renameScenario, setMarketCase, editStrategy, setDrill } = useStore.getState();
  const issues = [...b.resolveIssues, ...b.result.issues];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warning').length;
  return (
    <div className="editor">
      <div className="editor-head">
        <TextField value={b.scenario.name} onCommit={(v) => renameScenario(id, v)} />
        <div className="grid2">
          <TextField label="Strategy" value={b.strategy.name} onCommit={(v) => editStrategy(id, (s) => (s.name = v), [])} />
          <Select label="Market case" value={b.scenario.marketCaseId} options={Object.values(ws.marketCases).map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => setMarketCase([id], v)} tip="Market cases are assumption bundles, not statistical percentiles (unless the benchmark explicitly supports that reading)." />
        </div>
        {(errors > 0 || warns > 0) && (
          <button className={`link small ${errors ? 'bad' : 'warn'}`} onClick={() => setDrill({ kind: 'issues', scenarioId: id })}>
            {errors ? `✕ ${errors} error(s)` : ''} {warns ? `! ${warns} warning(s)` : ''} — view
          </button>
        )}
        {b.scenario.parentId && <div className="muted small">Cloned from {ws.scenarios[b.scenario.parentId]?.name ?? 'a deleted scenario'}</div>}
      </div>
      <FundEditor b={b} />
      <CohortsEditor b={b} />
    </div>
  );
}
