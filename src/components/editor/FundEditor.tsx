import type { ScenarioBundle } from '../../state/results';
import { useStore } from '../../state/store';
import { NumField, Section, Select, Toggle, TextField } from '../fields';
import { money } from '../../lib/format';

export function FundEditor({ b }: { b: ScenarioBundle }) {
  const f = b.strategy.fund;
  const id = b.scenario.id;
  const edit = useStore.getState().editStrategy;
  const set = (path: string, fn: (fund: typeof f) => void) => edit(id, (s) => fn(s.fund), [`fund.${path}`]);
  const cap = b.result.capital;
  const gap = cap.sleeveGap;
  const sleeveTotal = f.sleeves.reduce((a, s) => a + s.amount, 0);

  return (
    <Section title="Fund terms" defaultOpen>
      <div className="grid2">
        <NumField label="Committed" unit="m" value={f.committedCapital} prov={b.prov('fund.committedCapital')} min={1} onCommit={(v) => set('committedCapital', (x) => (x.committedCapital = v))} />
        <Select label="Currency" value={f.currency} options={['EUR', 'USD', 'GBP'].map((c) => ({ value: c, label: c }))} onChange={(v) => set('currency', (x) => (x.currency = v))} tip="Single fund currency. No FX conversion is ever applied." />
        <NumField label="Investment period" unit="yrs" integer min={0} value={f.investmentPeriodYears} prov={b.prov('fund.investmentPeriodYears')} onCommit={(v) => set('investmentPeriodYears', (x) => (x.investmentPeriodYears = v))} />
        <NumField label="Fund life" unit="yrs" integer min={1} value={f.fundLifeYears} prov={b.prov('fund.fundLifeYears')} onCommit={(v) => set('fundLifeYears', (x) => (x.fundLifeYears = v))} />
      </div>

      <h4>Management fees</h4>
      <Toggle label="Charge management fees" checked={f.fees.enabled} onChange={(v) => set('fees', (x) => (x.fees.enabled = v))} tip="Off: all commitments are investable. On: fees are called from LPs as paid-in capital and reduce investable capital. No recycling." />
      {f.fees.enabled && (
        <div className="grid2">
          <NumField label="Inv. period rate (commitments)" unit="%" value={f.fees.investmentPeriodRate} prov={b.prov('fund.fees')} onCommit={(v) => set('fees', (x) => (x.fees.investmentPeriodRate = v))} />
          <NumField label="Post-period rate" unit="%" value={f.fees.postPeriodRate} prov={b.prov('fund.fees')} onCommit={(v) => set('fees', (x) => (x.fees.postPeriodRate = v))} />
          <Select label="Post-period basis" value={f.fees.postPeriodBasis} options={[{ value: 'net_invested', label: 'Net invested capital' }, { value: 'commitments', label: 'Commitments' }]} onChange={(v) => set('fees', (x) => (x.fees.postPeriodBasis = v))} />
          <div className="field"><span className="field-label">Lifetime fees</span><span className="val n">{money(cap.totalFees)}m</span></div>
        </div>
      )}

      <h4>Reserve</h4>
      <div className="grid2">
        <Select label="Reserve as" value={f.reserve.mode} options={[{ value: 'percent', label: '% of investable' }, { value: 'amount', label: 'Amount' }]} onChange={(v) => set('reserve', (x) => (x.reserve = { mode: v, value: v === 'percent' ? cap.reserve / Math.max(1e-9, cap.investable) : cap.reserve }))} />
        <NumField label={f.reserve.mode === 'percent' ? 'Reserve %' : 'Reserve amount'} unit={f.reserve.mode === 'percent' ? '%' : 'm'} min={0} value={f.reserve.value} prov={b.prov('fund.reserve')} onCommit={(v) => set('reserve', (x) => (x.reserve.value = v))} />
      </div>
      <div className="muted small">Reserve = {money(cap.reserve)}m earmarked for follow-ons; planned {money(cap.followOnInvested)}m.</div>

      <h4>Carry</h4>
      <Toggle label="Model carried interest" checked={f.carry.enabled} onChange={(v) => set('carry', (x) => (x.carry.enabled = v))} tip="European (whole-fund) waterfall. Net LP metrics need both fees and carry." />
      {f.carry.enabled && (
        <div className="grid2">
          <NumField label="Carry" unit="%" value={f.carry.carryRate} prov={b.prov('fund.carry')} min={0} max={0.5} onCommit={(v) => set('carry', (x) => (x.carry.carryRate = v))} />
          <NumField label="Hurdle (compounding)" unit="%" value={f.carry.hurdleRate} prov={b.prov('fund.carry')} min={0} onCommit={(v) => set('carry', (x) => (x.carry.hurdleRate = v))} />
          <NumField label="GP catch-up" unit="%" value={f.carry.catchUpRate} prov={b.prov('fund.carry')} min={0} max={1} onCommit={(v) => set('carry', (x) => (x.carry.catchUpRate = v))} />
        </div>
      )}

      <h4>Sleeves</h4>
      <table className="dense">
        <thead>
          <tr><th>Sleeve</th><th className="n">Amount</th><th>Use</th><th className="n">Invested</th></tr>
        </thead>
        <tbody>
          {f.sleeves.map((s, i) => {
            const u = cap.sleeveUsage.find((x) => x.sleeveId === s.id);
            return (
              <tr key={s.id}>
                <td><TextField value={s.label} width={100} onCommit={(v) => set('sleeves', (x) => (x.sleeves[i].label = v))} /></td>
                <td className="n"><NumField unit="m" width={56} value={s.amount} min={0} prov={b.prov('fund.sleeves')} onCommit={(v) => set('sleeves', (x) => (x.sleeves[i].amount = v))} /></td>
                <td>
                  <Select value={s.use} options={[{ value: 'direct', label: 'Direct investments' }, { value: 'separate', label: 'Separate use' }]} onChange={(v) => set('sleeves', (x) => (x.sleeves[i].use = v))} tip="Direct: funds cohort investments. Separate: a separate use of capital, not modelled as investments (v1)." />
                </td>
                <td className={`n ${u && s.use === 'direct' && u.invested > s.amount ? 'bad' : ''}`}>{s.use === 'direct' ? money(u?.invested) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td>Total</td><td className="n">{money(sleeveTotal)}</td><td colSpan={2} /></tr>
        </tfoot>
      </table>
      {f.fees.enabled && gap > 0.05 && (
        <div className="callout">
          Sleeves total {money(sleeveTotal)}m but investable capital after fees is {money(cap.investable)}m — a gap of <b>{money(gap)}m</b>. Nothing is adjusted automatically.
          <div className="row gap">
            <button
              onClick={() => {
                const k = cap.investable / sleeveTotal;
                set('sleeves', (x) => x.sleeves.forEach((s) => (s.amount = +(s.amount * k).toFixed(4))));
              }}
            >
              Scale sleeves pro rata
            </button>
            {f.sleeves.map((s, i) => (
              <button key={s.id} disabled={s.amount < gap} onClick={() => set('sleeves', (x) => (x.sleeves[i].amount = +(x.sleeves[i].amount - gap).toFixed(4)))}>
                Reduce {s.label} by {money(gap)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
