import { Fragment } from 'react';
import type { ScenarioBundle } from '../../state/results';
import { useStore } from '../../state/store';
import { METRICS } from '../../lib/metrics';
import { useResolvedTheme, chartColors } from '../../lib/theme';

export function Comparison({ bundles }: { bundles: ScenarioBundle[] }) {
  const setDrill = useStore((s) => s.setDrill);
  const drill = useStore((s) => s.drill);
  const colors = chartColors(useResolvedTheme()).series;
  if (!bundles.length) return <div className="empty">Tick up to three scenarios in the list to compare them.</div>;
  const groups = ['Capital', 'Returns', 'Shape'] as const;
  const base = bundles[0];
  return (
    <div className="table-scroll">
      <table className="compare">
        <thead>
          <tr>
            <th>Metric <span className="muted small">· {base.result.currency}m · expected cash-flow case</span></th>
            {bundles.map((b, i) => (
              <th key={b.scenario.id} className="n">
                <span className="swatch" style={{ background: colors[i] }} />
                {b.scenario.name}
                <div className="muted small">
                  <span className={`case case-${b.marketCase.kind}`}>{b.marketCase.name}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr className="group"><td colSpan={bundles.length + 1}>{g}</td></tr>
              {METRICS.filter((m) => m.group === g).map((m) => (
                <tr key={m.key}>
                  <td data-tip={m.tip}>
                    {m.label}
                    {m.netNote && <span className="muted small"> ⓘ</span>}
                  </td>
                  {bundles.map((b, i) => {
                    const v = m.value(b.result);
                    const bv = m.value(base.result);
                    const raw = i > 0 && v != null && bv != null ? v - bv : null;
                    const dText = raw == null ? '' : m.deltaFormat ? m.deltaFormat(raw) : `${raw > 0 ? '+' : ''}${raw.toFixed(1)}`;
                    // hide deltas that round to zero at display precision
                    const d = raw != null && /[1-9]/.test(dText) ? raw : null;
                    const good = d != null && m.better !== 0 && Math.abs(d) > 1e-9 ? Math.sign(d) === m.better : null;
                    const active = drill?.kind === 'metric' && drill.metric === m.key && drill.scenarioId === b.scenario.id;
                    const netTip = m.netNote ? `\n${b.result.net.convention}` : '';
                    return (
                      <td key={b.scenario.id} className={`n clickable ${active ? 'active' : ''} ${m.key === 'overAllocation' && (v ?? 0) > 1e-6 ? 'bad' : ''}`} onClick={() => setDrill({ kind: 'metric', scenarioId: b.scenario.id, metric: m.key })} data-tip={`${m.tip}${netTip}\nDerived — click to see contributors.`}>
                        {m.format(b.result)}
                        {d != null && <div className={`delta ${good === true ? 'good' : good === false ? 'bad' : ''}`}>{dText}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {bundles.some((b) => b.result.net.available) && (
        <div className="muted small convention">Net metrics: {bundles.find((b) => b.result.net.available)!.result.net.convention}. Deltas are vs the first column.</div>
      )}
    </div>
  );
}
