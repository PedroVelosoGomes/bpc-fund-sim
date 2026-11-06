import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';
import type { ScenarioBundle } from '../../state/results';
import { useStore } from '../../state/store';
import { chartColors, useResolvedTheme } from '../../lib/theme';
import { money, pct } from '../../lib/format';

const tickFmt = (v: number) => money(v, 0);

function useC() {
  return chartColors(useResolvedTheme());
}

function ChartTooltip({ active, payload, label, unit = 'm', labelPrefix = 'Year ' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{labelPrefix}{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="row nowrap">
          <span className="swatch" style={{ background: p.color ?? p.fill }} />
          <span>{p.name}</span>
          <span className="spacer" />
          <span className="n">{money(p.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** J-curve: cumulative LP net cash flow for each compared scenario. */
export function JCurveChart({ bundles }: { bundles: ScenarioBundle[] }) {
  const c = useC();
  const years = Math.max(...bundles.map((b) => b.result.annual.length));
  const data = Array.from({ length: years }, (_, t) => {
    const row: Record<string, number> = { year: t };
    bundles.forEach((b, i) => (row[`s${i}`] = b.result.annual[t]?.cumulativeLpNetFlow ?? b.result.annual.at(-1)!.cumulativeLpNetFlow));
    return row;
  });
  const anyNoCarry = bundles.some((b) => !b.result.net.available);
  return (
    <figure className="chart">
      <figcaption>
        Cumulative LP net cash flow (J-curve)
        <span className="muted small"> · {anyNoCarry ? 'before carry where fees/carry are off' : 'after fees and carry'}</span>
      </figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="year" stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={tickFmt} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={0} stroke={c.ref} strokeWidth={1} />
          <Tooltip content={<ChartTooltip />} />
          {bundles.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {bundles.map((b, i) => (
            <Line key={b.scenario.id} type="linear" dataKey={`s${i}`} name={b.scenario.name} stroke={c.series[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Annual investments, fees and distributions for one scenario. Click a year to drill into its cash flows. */
export function AnnualChart({ b }: { b: ScenarioBundle }) {
  const c = useC();
  const setDrill = useStore((s) => s.setDrill);
  const data = b.result.annual.map((a) => ({ year: a.year, inv: -(a.initialInvestment + a.followOnInvestment), fees: -a.fees, dist: a.grossProceeds }));
  return (
    <figure className="chart">
      <figcaption>
        Annual cash flows — {b.scenario.name} <span className="muted small">· click a year for its cash-flow lines</span>
      </figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} onClick={(e: any) => e?.activeLabel !== undefined && setDrill({ kind: 'year', scenarioId: b.scenario.id, year: Number(e.activeLabel) })}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="year" stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickLine={false} />
          <YAxis stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={tickFmt} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={0} stroke={c.ref} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: c.grid, opacity: 0.5 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="dist" name="Gross distributions" stackId="a" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="inv" name="Investments" stackId="a" fill={c.series[1]} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="fees" name="Fees" stackId="a" fill={c.series[2]} radius={[0, 0, 4, 4]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

const KIND_ORDER = ['modest', 'strong', 'outlier'] as const;

/** Proceeds by cohort, stacked by outcome kind (write-offs contribute 0). */
export function ProceedsChart({ bundles }: { bundles: ScenarioBundle[] }) {
  const c = useC();
  const setDrill = useStore((s) => s.setDrill);
  const rows = bundles.flatMap((b) =>
    b.result.cohorts.map((co) => {
      const r: Record<string, any> = { name: bundles.length > 1 ? `${b.scenario.name} · ${co.label}` : co.label, scenarioId: b.scenario.id, cohortId: co.cohortId };
      for (const k of KIND_ORDER) r[k] = co.buckets.filter((x) => x.kind === k).reduce((a, x) => a + x.proceeds, 0);
      r.other = co.buckets.filter((x) => !KIND_ORDER.includes(x.kind as any) && x.kind !== 'writeoff').reduce((a, x) => a + x.proceeds, 0);
      return r;
    }),
  );
  const colorFor = { modest: c.series[0], strong: c.series[1], outlier: c.series[2] };
  return (
    <figure className="chart">
      <figcaption>Gross proceeds by cohort and outcome <span className="muted small">· click a bar to inspect the cohort</span></figcaption>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34 + 60)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap={8}>
          <CartesianGrid stroke={c.grid} horizontal={false} />
          <XAxis type="number" stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={tickFmt} tickLine={false} />
          <YAxis type="category" dataKey="name" stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} width={180} tickLine={false} />
          <Tooltip content={<ChartTooltip labelPrefix="" />} cursor={{ fill: c.grid, opacity: 0.5 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {KIND_ORDER.map((k, i) => (
            <Bar key={k} dataKey={k} name={k[0].toUpperCase() + k.slice(1)} stackId="p" fill={colorFor[k]} stroke={c.surface} strokeWidth={1} radius={i === KIND_ORDER.length - 1 ? [0, 4, 4, 0] : 0} maxBarSize={20} isAnimationActive={false} onClick={(d: any) => setDrill({ kind: 'cohort', scenarioId: d.scenarioId, cohortId: d.cohortId })} style={{ cursor: 'pointer' }} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Reserve: planned follow-ons per year vs the earmarked reserve, for one scenario. */
export function ReserveView({ b }: { b: ScenarioBundle }) {
  const c = useC();
  const cap = b.result.capital;
  const data = b.result.annual.map((a) => ({ year: a.year, fo: a.followOnInvestment, cum: a.cumulativeFollowOn, over: a.reserveOverAllocated }));
  const lastFoYear = Math.max(0, ...b.result.annual.filter((a) => a.followOnInvestment > 1e-9).map((a) => a.year));
  return (
    <div>
      <div className="kpis">
        <Kpi label="Reserve" value={money(cap.reserve)} />
        <Kpi label="Planned follow-ons" value={money(cap.followOnInvested)} />
        <Kpi label="Unused reserve" value={money(cap.reserveUnused)} />
        <Kpi label="Reserve over-allocation" value={money(cap.reserveOverAllocation)} bad={cap.reserveOverAllocation > 1e-6} />
        <Kpi label="Initial vs budget" value={`${money(cap.initialInvested)} / ${money(cap.initialBudget)}`} bad={cap.initialOverAllocation > 1e-6} />
        <Kpi label="Unused capacity" value={money(cap.unusedCapacity)} bad={cap.unusedCapacity < -1e-6} />
      </div>
      <figure className="chart">
        <figcaption>Planned follow-ons vs reserve — {b.scenario.name}</figcaption>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="year" stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickLine={false} />
            <YAxis stroke={c.axis} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={tickFmt} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={cap.reserve} stroke={c.ref} strokeDasharray="4 3" label={{ value: `Reserve ${money(cap.reserve)}`, fill: c.text, fontSize: 11, position: 'insideTopLeft' }} />
            <Bar dataKey="fo" name="Follow-on this year" fill={c.series[1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.year} fill={d.over ? c.bad : c.series[1]} />)}
            </Bar>
            <Line dataKey="cum" name="Cumulative follow-on" stroke={c.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </figure>
      <table className="dense">
        <thead><tr><th className="n">Year</th><th className="n">Planned follow-on</th><th className="n">Cumulative</th><th className="n">Reserve remaining</th></tr></thead>
        <tbody>
          {b.result.annual.slice(0, lastFoYear + 1).map((a) => (
            <tr key={a.year}>
              <td className="n">{a.year}</td>
              <td className="n">{money(a.followOnInvestment)}</td>
              <td className="n">{money(a.cumulativeFollowOn)}</td>
              <td className={`n ${a.reserveOverAllocated ? 'bad' : ''}`}>{money(a.reserveRemaining)}{a.reserveOverAllocated ? ' over' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>By cohort</h4>
      <table className="dense">
        <thead><tr><th>Cohort</th><th>Policy</th><th className="n">Initial</th><th className="n">Follow-on</th><th className="n">Share of reserve</th><th className="n" data-tip="Initial + largest planned follow-on for one company">Max exposure / co.</th></tr></thead>
        <tbody>
          {b.result.cohorts.map((co) => {
            const sc = b.strategy.cohorts.find((x) => x.id === co.cohortId);
            return (
              <tr key={co.cohortId}>
                <td>{co.label}</td>
                <td>{sc?.followOn.kind.replace('_', ' ')}</td>
                <td className="n">{money(co.initialInvested)}</td>
                <td className="n">{money(co.followOnInvested)}</td>
                <td className="n">{pct(cap.reserve > 0 ? co.followOnInvested / cap.reserve : null)}</td>
                <td className="n">{money(co.maxCompanyExposure, 2)} <span className="muted">({pct(co.maxCompanyExposure / cap.committed)})</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`kpi ${bad ? 'bad' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value n">{bad ? '▲ ' : ''}{value}</div>
    </div>
  );
}
