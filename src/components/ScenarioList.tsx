import { useStore } from '../state/store';
import { useBundles } from '../state/results';
import { mult } from '../lib/format';

export function ScenarioList() {
  const ws = useStore((s) => s.ws);
  const ui = useStore((s) => s.ui);
  const { focus, toggleCompare, cloneScenario, deleteScenario, setMarketCase } = useStore.getState();
  const bundles = useBundles(ws.scenarioOrder);
  const cases = Object.values(ws.marketCases);
  const order = { downside: 0, base: 1, upside: 2, custom: 3 } as const;
  cases.sort((a, b) => order[a.kind] - order[b.kind]);

  return (
    <div className="scenario-list">
      <div className="list-head">
        <h2>Scenarios</h2>
        <span className="muted small">compare ≤ 3</span>
      </div>
      <table className="dense">
        <tbody>
          {bundles.map((b) => {
            const id = b.scenario.id;
            const errors = [...b.result.issues, ...b.resolveIssues].filter((i) => i.severity === 'error').length;
            const warns = b.result.issues.filter((i) => i.severity === 'warning').length;
            const checked = ui.compareIds.includes(id);
            const disabled = !checked && ui.compareIds.length >= 3;
            return (
              <tr key={id} className={ui.focusedId === id ? 'focused' : ''} onClick={() => focus(id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label="Compare" checked={checked} disabled={disabled} onChange={() => toggleCompare(id)} data-tip={disabled ? 'Up to three scenarios can be compared' : 'Include in comparison'} />
                </td>
                <td className="sc-name">
                  <div>{b.scenario.name}</div>
                  <div className="muted small">
                    {b.strategy.name.replace(/ \(demo\)$/, '')} · <span className={`case case-${b.marketCase.kind}`}>{b.marketCase.name}</span>
                  </div>
                </td>
                <td className="n" data-tip="Gross MOIC (expected cash-flow case)">{mult(b.result.gross.moic)}</td>
                <td className="n">
                  {errors > 0 ? <span className="badge bad" data-tip={`${errors} error(s)`}>✕ {errors}</span> : warns > 0 ? <span className="badge warn" data-tip={`${warns} warning(s)`}>! {warns}</span> : null}
                </td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon" data-tip="Clone scenario (creates an independent copy to edit)" onClick={() => cloneScenario(id)}>⧉</button>
                  <button
                    className="icon"
                    data-tip="Delete scenario"
                    onClick={() => {
                      if (confirm(`Delete "${b.scenario.name}"?`)) deleteScenario(id);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ui.compareIds.length > 0 && cases.length > 1 && (
        <div className="switch-row">
          <span className="muted small">Switch compared scenarios to:</span>
          {cases.map((c) => (
            <button key={c.id} className={`chip case-${c.kind}`} onClick={() => setMarketCase(ui.compareIds, c.id)} data-tip={`Set the market case of all ${ui.compareIds.length} compared scenarios to "${c.name}". Strategies are unchanged.`}>
              {c.name.replace(/ \(demo\)$/, '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
