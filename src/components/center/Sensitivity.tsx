import { useMemo, useState } from 'react';
import { defaultAxis, sensitivityGrid, SENSITIVITY_VARIABLES, type SensitivityMetric, type SensitivityVariable } from '../../../engine';
import type { ScenarioBundle } from '../../state/results';
import { Select } from '../fields';
import { mult, pct } from '../../lib/format';
import { SEQ_BLUE } from '../../lib/theme';

const fmtAxis = (v: SensitivityVariable, x: number) => {
  const u = SENSITIVITY_VARIABLES[v].unit;
  return u === 'x' ? `${x.toFixed(2)}×` : u === 'pp' ? `${x > 0 ? '+' : ''}${(x * 100).toFixed(0)}pp` : `${x > 0 ? '+' : ''}${x}y`;
};

export function Sensitivity({ b }: { b: ScenarioBundle }) {
  const [xv, setX] = useState<SensitivityVariable>('exitValueMultiplier');
  const [yv, setY] = useState<SensitivityVariable>('writeOffRateShift');
  const [metric, setMetric] = useState<SensitivityMetric>('grossMoic');
  const [n, setN] = useState(7);
  const grid = useMemo(() => sensitivityGrid(b.model, { variable: xv, values: defaultAxis(xv, n) }, { variable: yv, values: defaultAxis(yv, n) }, metric), [b.model, xv, yv, metric, n]);
  const vals = grid.cells.flat().filter((v): v is number => v != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const isMult = metric === 'grossMoic' || metric === 'netMultiple';
  const fmt = (v: number | null) => (v == null ? 'N/A' : isMult ? mult(v) : pct(v));
  const varOpts = (Object.keys(SENSITIVITY_VARIABLES) as SensitivityVariable[]).map((k) => ({ value: k, label: SENSITIVITY_VARIABLES[k].label }));
  const cx = grid.x.values.findIndex((v) => v === SENSITIVITY_VARIABLES[xv].neutral);
  const cy = grid.y.values.findIndex((v) => v === SENSITIVITY_VARIABLES[yv].neutral);

  return (
    <div>
      <div className="row wrap controls">
        <Select label="Columns (x)" value={xv} options={varOpts} onChange={setX} />
        <Select label="Rows (y)" value={yv} options={varOpts} onChange={setY} />
        <Select label="Metric" value={metric} options={[{ value: 'grossMoic', label: 'Gross MOIC' }, { value: 'grossIrr', label: 'Gross IRR' }, { value: 'netMultiple', label: 'Net LP multiple' }, { value: 'netIrr', label: 'Net IRR' }]} onChange={setMetric} />
        <Select label="Grid" value={String(n)} options={[{ value: '5', label: '5×5' }, { value: '7', label: '7×7' }, { value: '9', label: '9×9' }]} onChange={(v) => setN(Number(v))} />
      </div>
      <div className="muted small">{b.scenario.name} · expected cash-flow case · centre cell (outlined) = current assumptions. Each cell re-runs the full engine with both perturbations applied.</div>
      {xv === yv && <div className="small warn">Same variable on both axes — perturbations compound.</div>}
      {(xv === 'timeToExitShift' || yv === 'timeToExitShift') && (metric === 'grossMoic' || metric === 'netMultiple') && (
        <div className="small muted">Note: multiples do not depend on exit timing (only fee drag via NIC does for net); pick an IRR metric to see the timing effect.</div>
      )}
      <div className="table-scroll">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="muted small">{SENSITIVITY_VARIABLES[yv].label} ↓ / {SENSITIVITY_VARIABLES[xv].label} →</th>
              {grid.x.values.map((x) => <th key={x} className="n">{fmtAxis(xv, x)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.y.values.map((y, yi) => (
              <tr key={y}>
                <th className="n">{fmtAxis(yv, y)}</th>
                {grid.cells[yi].map((v, xi) => {
                  const t = v == null || hi === lo ? 0 : (v - lo) / (hi - lo);
                  const idx = Math.round(t * (SEQ_BLUE.length - 1));
                  const bg = v == null ? 'transparent' : SEQ_BLUE[idx];
                  const dark = idx >= 6;
                  return (
                    <td key={xi} className={`n ${xi === cx && yi === cy ? 'centre' : ''}`} style={{ background: bg, color: dark ? '#fff' : '#0b0b0b' }} data-tip={`${SENSITIVITY_VARIABLES[xv].label} ${fmtAxis(xv, grid.x.values[xi])}, ${SENSITIVITY_VARIABLES[yv].label} ${fmtAxis(yv, y)} → ${fmt(v)}`}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend-ramp">
        <span className="small">{fmt(lo)}</span>
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${SEQ_BLUE[0]}, ${SEQ_BLUE[SEQ_BLUE.length - 1]})` }} />
        <span className="small">{fmt(hi)}</span>
      </div>
    </div>
  );
}
