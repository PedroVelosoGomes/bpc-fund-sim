import { evaluateFund, irrLabel, presets, resolveScenario } from '../engine';

const fmt = (v: number | null | undefined, d = 1) => (v == null ? 'N/A' : v.toFixed(d));
const pct = (v: number | null | undefined) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`);

/** Phase 1 placeholder: renders the demo preset through the engine. The three-area workspace arrives in phase 2. */
export function App() {
  const { model } = resolveScenario(presets.brightPixelStrategy, presets.brightPixelBaseCase);
  const r = evaluateFund(model);
  const c = r.capital;
  const rows: [string, string][] = [
    ['Committed', fmt(c.committed)],
    ['Lifetime management fees', fmt(c.totalFees)],
    ['Investable (committed − fees)', fmt(c.investable)],
    ['Separate-use sleeves', fmt(c.separateSleeves)],
    ['Reserve', fmt(c.reserve)],
    ['Initial invested', fmt(c.initialInvested)],
    ['Follow-on invested (planned)', fmt(c.followOnInvested)],
    ['Invested', fmt(c.invested)],
    ['Paid-in (invested + fees)', fmt(c.paidIn)],
    ['Reserve unused', fmt(c.reserveUnused)],
    ['Unused capacity', fmt(c.unusedCapacity)],
    ['Gross proceeds', fmt(r.gross.proceeds)],
    ['Gross MOIC', `${fmt(r.gross.moic, 2)}×`],
    ['Gross IRR', irrLabel(r.gross.irr)],
    ['Net LP multiple', r.net.available ? `${fmt(r.net.netMultiple, 2)}×` : r.net.reason!],
    ['Net IRR', r.net.available ? irrLabel(r.net.netIrr) : r.net.reason!],
    ['Outlier share of proceeds', pct(r.outlierShare)],
    ['Time to first distribution (years)', fmt(r.timeToFirstDistribution, 0)],
  ];
  return (
    <div className="wrap">
      <h1>{model.fund.name}</h1>
      <div className="muted">
        {r.label} · {r.currency}m · <span className="tag">demo data</span>
      </div>
      <p className="muted">
        At €2–3M initial tickets across {model.cohorts.reduce((a, x) => a + x.companyCount, 0)} companies, initial deployment is {fmt(c.initialInvested)}m —
        roughly {pct(c.initialInvested / c.investable)} of investable capital; the rest sits in reserves or other sleeves.
      </p>
      <h2>Fund summary</h2>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="n">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 4 }}>{r.net.convention}</div>
      <h2>Cohorts</h2>
      <table>
        <thead>
          <tr><th>Cohort</th><th className="n">Companies</th><th className="n">Entry own.</th><th className="n">Initial</th><th className="n">Follow-on</th><th className="n">Proceeds</th><th className="n">Gross MOIC</th></tr>
        </thead>
        <tbody>
          {r.cohorts.map((x) => (
            <tr key={x.cohortId}>
              <td>{x.label}</td><td className="n">{x.companyCount}</td><td className="n">{pct(x.entryOwnership)}</td><td className="n">{fmt(x.initialInvested)}</td>
              <td className="n">{fmt(x.followOnInvested)}</td><td className="n">{fmt(x.proceeds)}</td><td className="n">{fmt(x.grossMoic, 2)}×</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Annual (LP view)</h2>
      <table>
        <thead><tr><th className="n">Year</th><th className="n">Initial</th><th className="n">Follow-on</th><th className="n">Fees</th><th className="n">Proceeds</th><th className="n">LP dist.</th><th className="n">Cum. LP net</th></tr></thead>
        <tbody>
          {r.annual.map((a) => (
            <tr key={a.year}>
              <td className="n">{a.year}</td><td className="n">{fmt(a.initialInvestment)}</td><td className="n">{fmt(a.followOnInvestment)}</td><td className="n">{fmt(a.fees)}</td>
              <td className="n">{fmt(a.grossProceeds)}</td><td className="n">{fmt(a.lpDistributions)}</td><td className="n">{fmt(a.cumulativeLpNetFlow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Validation</h2>
      <ul>{r.issues.map((i, k) => <li key={k} className={`issue-${i.severity}`}>{i.severity}: {i.message}</li>)}</ul>
    </div>
  );
}
