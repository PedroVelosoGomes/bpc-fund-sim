import { comparePolicies, exitEquityValue, type CashFlowLine, type OwnershipStep } from '../../../engine';
import { useBundle, type ScenarioBundle } from '../../state/results';
import { useStore, type Drill } from '../../state/store';
import { metricDef } from '../../lib/metrics';
import { IRR_TOOLTIP, irrFmt, money, mult, pct, provenanceText, provClass } from '../../lib/format';
import { Val } from '../fields';

export function DrillPanel() {
  const drill = useStore((s) => s.drill);
  const focusedId = useStore((s) => s.ui.focusedId);
  const b = useBundle(drill?.scenarioId ?? focusedId);
  const setDrill = useStore((s) => s.setDrill);
  if (!b) return <div className="empty">No scenario selected.</div>;
  return (
    <div className="drill">
      <div className="drill-head">
        <Breadcrumb b={b} drill={drill} />
        {drill && <button className="icon" onClick={() => setDrill(null)} data-tip="Close drill-down">✕</button>}
      </div>
      {!drill && <Overview b={b} />}
      {drill?.kind === 'metric' && <MetricDrill b={b} metric={drill.metric} />}
      {drill?.kind === 'cohort' && <CohortDrill b={b} cohortId={drill.cohortId} />}
      {drill?.kind === 'bucket' && <BucketDrill b={b} cohortId={drill.cohortId} bucketId={drill.bucketId} />}
      {drill?.kind === 'year' && <YearDrill b={b} year={drill.year} />}
      {drill?.kind === 'issues' && <IssuesList b={b} />}
    </div>
  );
}

function Breadcrumb({ b, drill }: { b: ScenarioBundle; drill: Drill | null }) {
  const setDrill = useStore((s) => s.setDrill);
  const sid = b.scenario.id;
  const parts: { label: string; to: Drill | null }[] = [{ label: b.scenario.name, to: null }];
  if (drill?.kind === 'metric') parts.push({ label: metricDef(drill.metric).label, to: drill });
  if (drill?.kind === 'cohort' || drill?.kind === 'bucket') {
    const co = b.result.cohorts.find((c) => c.cohortId === drill.cohortId);
    parts.push({ label: co?.label ?? drill.cohortId, to: { kind: 'cohort', scenarioId: sid, cohortId: drill.cohortId } });
    if (drill.kind === 'bucket') parts.push({ label: co?.buckets.find((x) => x.bucketId === drill.bucketId)?.label ?? drill.bucketId, to: drill });
  }
  if (drill?.kind === 'year') parts.push({ label: `Year ${drill.year}`, to: drill });
  if (drill?.kind === 'issues') parts.push({ label: 'Validation', to: drill });
  return (
    <nav className="crumbs">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="muted"> › </span>}
          <button className="link" onClick={() => setDrill(p.to)}>{p.label}</button>
        </span>
      ))}
    </nav>
  );
}

function Overview({ b }: { b: ScenarioBundle }) {
  const setDrill = useStore((s) => s.setDrill);
  const r = b.result;
  const c = r.capital;
  return (
    <div>
      <p className="muted small">Click any metric, chart bar or cohort to inspect what produced it. Showing the focused scenario.</p>
      <h4>Fund summary</h4>
      <table className="dense">
        <tbody>
          <Row k="Committed" v={money(c.committed)} />
          <Row k="− Lifetime fees" v={money(c.totalFees)} />
          <Row k="= Investable" v={money(c.investable)} />
          {c.separateSleeves > 0 && <Row k="− Separate-use sleeves" v={money(c.separateSleeves)} />}
          <Row k="− Reserve" v={money(c.reserve)} />
          <Row k="= Initial budget" v={money(c.initialBudget)} />
          <Row k="Initial invested" v={money(c.initialInvested)} />
          <Row k="Planned follow-ons" v={money(c.followOnInvested)} />
        </tbody>
      </table>
      <div className="callout small">
        At these tickets, initial deployment is {money(c.initialInvested)}m — {pct(c.initialInvested / c.investable)} of investable capital. The remaining {money(c.investable - c.initialInvested)}m sits in reserves ({money(c.reserve)}m), other sleeves ({money(c.separateSleeves)}m) or is unused ({money(c.unusedCapacity)}m).
      </div>
      <button className="link" onClick={() => setDrill({ kind: 'issues', scenarioId: b.scenario.id })}>
        {r.issues.length + b.resolveIssues.length} validation message(s) ›
      </button>
      <h4>Provenance legend</h4>
      <div className="legend-prov">
        <span className="prov prov-benchmark val">benchmark</span>
        <span className="prov prov-demo val">demo data</span>
        <span className="prov prov-user val">user override</span>
        <span className="prov prov-default val">default</span>
      </div>
    </div>
  );
}

const Row = ({ k, v, bad, onClick }: { k: string; v: string; bad?: boolean; onClick?: () => void }) => (
  <tr className={onClick ? 'clickable' : ''} onClick={onClick}>
    <td>{k}</td>
    <td className={`n ${bad ? 'bad' : ''}`}>{v}</td>
  </tr>
);

function MetricDrill({ b, metric }: { b: ScenarioBundle; metric: Parameters<typeof metricDef>[0] }) {
  const def = metricDef(metric);
  const r = b.result;
  const c = r.capital;
  return (
    <div>
      <div className="metric-hero">
        <div className="muted small">{def.label}</div>
        <div className="hero n">{def.format(r)}</div>
        <div className="small muted">{def.tip}</div>
        {def.netNote && <div className="small convention">{r.net.convention}</div>}
      </div>
      {(metric === 'grossMoic' || metric === 'grossProceeds' || metric === 'invested') && (
        <>
          <div className="formula">Gross MOIC = proceeds {money(r.gross.proceeds)} / invested {money(c.invested)} = {mult(r.gross.moic)}</div>
          <CohortContrib b={b} />
        </>
      )}
      {metric === 'outlierShare' && (
        <>
          <div className="formula">Outlier share = {money(r.outlierProceeds)} / {money(r.gross.proceeds)} = {pct(r.outlierShare)}</div>
          <CohortContrib b={b} only="outlier" />
        </>
      )}
      {metric === 'grossIrr' && <FlowsTable b={b} mode="gross" />}
      {(metric === 'netIrr' || metric === 'netMultiple' || metric === 'gpCarry') && (r.net.available ? <><Waterfall b={b} /><FlowsTable b={b} mode="lp" /></> : <div className="callout">N/A — enable fees and carry. Net LP metrics are shown only when fees, LP cash flows and the carry convention are all modelled.</div>)}
      {metric === 'fees' && <FeeTable b={b} />}
      {(['committed', 'paidIn', 'investable', 'reserveUsed', 'unusedCapacity', 'overAllocation'] as const).includes(metric as any) && <CapitalTable b={b} />}
      {metric === 'timeToFirstDistribution' && r.timeToFirstDistribution != null && <YearDrill b={b} year={r.timeToFirstDistribution} />}
    </div>
  );
}

function CohortContrib({ b, only }: { b: ScenarioBundle; only?: 'outlier' }) {
  const setDrill = useStore((s) => s.setDrill);
  const sid = b.scenario.id;
  return (
    <>
      <h4>Contributing cohorts</h4>
      <table className="dense">
        <thead><tr><th>Cohort</th><th className="n">Invested</th><th className="n">Proceeds</th><th className="n">MOIC</th><th className="n">Share</th></tr></thead>
        <tbody>
          {b.result.cohorts.map((co) => (
            <tr key={co.cohortId} className="clickable" onClick={() => setDrill({ kind: 'cohort', scenarioId: sid, cohortId: co.cohortId })}>
              <td>{co.label}</td>
              <td className="n">{money(co.invested)}</td>
              <td className="n">{money(co.proceeds)}</td>
              <td className="n">{mult(co.grossMoic)}</td>
              <td className="n">{pct(b.result.gross.proceeds > 0 ? co.proceeds / b.result.gross.proceeds : null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>By outcome bucket {only ? '(outliers)' : ''}</h4>
      <table className="dense">
        <thead><tr><th>Cohort / bucket</th><th className="n">Prob.</th><th className="n" data-tip="Exit ownership (non-recipient path)">Own.</th><th className="n">Equity</th><th className="n">Exit yr</th><th className="n">Proceeds</th><th className="n">Share</th></tr></thead>
        <tbody>
          {b.result.cohorts.flatMap((co) =>
            co.buckets
              .filter((bk) => !only || bk.kind === only)
              .map((bk) => {
                const pp = (f: string) => b.prov(`cohorts.${co.cohortId}.buckets.${bk.bucketId}.${f}`);
                return (
                  <tr key={co.cohortId + bk.bucketId} className="clickable" onClick={() => setDrill({ kind: 'bucket', scenarioId: sid, cohortId: co.cohortId, bucketId: bk.bucketId })}>
                    <td>{co.label} / {bk.label}</td>
                    <td className="n"><Val prov={pp('probability')}>{pct(bk.probability, 0)}</Val></td>
                    <td className="n"><Val tip="Derived from entry ownership and dilution">{pct(bk.exitOwnership)}</Val></td>
                    <td className="n"><Val prov={pp('exit')}>{money(bk.equityValue, 0)}</Val></td>
                    <td className="n"><Val prov={pp('yearsToExit')} tip={`Entry + ${bk.yearsToExit} years. ${provenanceText(pp('yearsToExit'))}`}>{bk.exitYears.length > 1 ? `${Math.min(...bk.exitYears)}–${Math.max(...bk.exitYears)}` : bk.exitYears[0]}</Val></td>
                    <td className="n">{money(bk.proceeds)}</td>
                    <td className="n">{pct(bk.shareOfFundProceeds)}</td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </>
  );
}

function FlowsTable({ b, mode }: { b: ScenarioBundle; mode: 'gross' | 'lp' }) {
  const setDrill = useStore((s) => s.setDrill);
  const rows = b.result.annual;
  return (
    <>
      <h4>{mode === 'gross' ? 'Gross flows (investments & proceeds, no fees)' : 'LP flows (paid-in & distributions after carry)'}</h4>
      <div className="small muted" data-tip={IRR_TOOLTIP}>IRR: {irrFmt(mode === 'gross' ? b.result.gross.irr : b.result.net.netIrr)} · annual, year-end flows ⓘ</div>
      <table className="dense">
        <thead>
          <tr><th className="n">Yr</th>{mode === 'gross' ? <><th className="n">Invest.</th><th className="n">Proceeds</th></> : <><th className="n">Paid-in</th><th className="n">LP dist.</th><th className="n">Carry</th></>}<th className="n">Net</th><th className="n">Cum.</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.year} className="clickable" onClick={() => setDrill({ kind: 'year', scenarioId: b.scenario.id, year: a.year })}>
              <td className="n">{a.year}</td>
              {mode === 'gross' ? (
                <>
                  <td className="n">{money(-(a.initialInvestment + a.followOnInvestment))}</td>
                  <td className="n">{money(a.grossProceeds)}</td>
                  <td className="n">{money(a.grossNetFlow)}</td>
                  <td className="n">{money(a.cumulativeGrossNetFlow)}</td>
                </>
              ) : (
                <>
                  <td className="n">{money(-a.paidIn)}</td>
                  <td className="n">{money(a.lpDistributions)}</td>
                  <td className="n">{money(a.gpCarry)}</td>
                  <td className="n">{money(a.lpNetFlow)}</td>
                  <td className="n">{money(a.cumulativeLpNetFlow)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Waterfall({ b }: { b: ScenarioBundle }) {
  const w = b.result.net.waterfall!;
  return (
    <>
      <h4>Waterfall tiers</h4>
      <table className="dense">
        <tbody>
          <Row k="Gross distributions" v={money(b.result.gross.proceeds)} />
          <Row k="1. Return of paid-in (incl. fees) → LP" v={money(w.returnOfCapital)} />
          <Row k="2. Preferred return → LP" v={money(w.preferredReturn)} />
          <Row k="3. GP catch-up → GP" v={money(w.catchUp)} />
          <Row k="4. Split → LP" v={money(w.splitToLp)} />
          <Row k="4. Split → GP" v={money(w.splitToGp)} />
          {w.clawback > 0 && <Row k="Clawback → LP" v={money(w.clawback)} />}
          <Row k="LP total" v={money(w.lpDistributions)} />
          <Row k="GP carry total" v={money(w.gpCarry)} />
          <Row k="Paid-in" v={money(b.result.capital.paidIn)} />
          <Row k="Net LP multiple" v={mult(b.result.net.netMultiple)} />
        </tbody>
      </table>
    </>
  );
}

function FeeTable({ b }: { b: ScenarioBundle }) {
  const f = b.strategy.fund;
  if (!f.fees.enabled) return <div className="callout">Fees are off: all commitments are investable.</div>;
  return (
    <>
      <h4>Fee schedule</h4>
      <table className="dense">
        <thead><tr><th className="n">Yr</th><th>Basis</th><th className="n">Fee</th></tr></thead>
        <tbody>
          {b.result.annual.slice(0, f.fundLifeYears).map((a) => {
            const inIp = a.year < f.investmentPeriodYears;
            const basis = inIp ? `${pct(f.fees.investmentPeriodRate)} × commitments ${money(f.committedCapital)}` : f.fees.postPeriodBasis === 'commitments' ? `${pct(f.fees.postPeriodRate)} × commitments` : `${pct(f.fees.postPeriodRate)} × NIC(y${a.year - 1}) ${money(b.result.annual[a.year - 1]?.netInvestedCapital ?? 0)}`;
            return (
              <tr key={a.year}>
                <td className="n">{a.year}</td>
                <td className="small">{basis}</td>
                <td className="n">{money(a.fees, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function CapitalTable({ b }: { b: ScenarioBundle }) {
  const c = b.result.capital;
  return (
    <>
      <h4>Capital (committed, paid-in and invested kept distinct)</h4>
      <table className="dense">
        <tbody>
          <Row k="Committed" v={money(c.committed)} />
          <Row k="Lifetime fees" v={money(c.totalFees)} />
          <Row k="Investable (committed − fees)" v={money(c.investable)} />
          <Row k="Separate-use sleeves" v={money(c.separateSleeves)} />
          <Row k="Direct investable" v={money(c.directInvestable)} />
          <Row k="Reserve" v={money(c.reserve)} />
          <Row k="Initial budget" v={money(c.initialBudget)} />
          <Row k="Initial invested" v={money(c.initialInvested)} bad={c.initialOverAllocation > 1e-6} />
          <Row k="Follow-on invested" v={money(c.followOnInvested)} />
          <Row k="Invested" v={money(c.invested)} />
          <Row k="Paid-in (invested + fees)" v={money(c.paidIn)} />
          <Row k="Reserve used / unused" v={`${money(c.reserveUsed)} / ${money(c.reserveUnused)}`} />
          <Row k="Reserve over-allocation" v={money(c.reserveOverAllocation)} bad={c.reserveOverAllocation > 1e-6} />
          <Row k="Initial over budget" v={money(c.initialOverAllocation)} bad={c.initialOverAllocation > 1e-6} />
          <Row k="Unused capacity" v={money(c.unusedCapacity)} bad={c.unusedCapacity < -1e-6} />
        </tbody>
      </table>
      <h4>Sleeves</h4>
      <table className="dense">
        <thead><tr><th>Sleeve</th><th>Use</th><th className="n">Amount</th><th className="n">Invested</th><th className="n">Remaining</th></tr></thead>
        <tbody>
          {c.sleeveUsage.map((s) => (
            <tr key={s.sleeveId}><td>{s.label}</td><td>{s.use}</td><td className="n">{money(s.amount)}</td><td className="n">{s.use === 'direct' ? money(s.invested) : '—'}</td><td className={`n ${s.remaining < 0 ? 'bad' : ''}`}>{money(s.remaining)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CohortDrill({ b, cohortId }: { b: ScenarioBundle; cohortId: string }) {
  const setDrill = useStore((s) => s.setDrill);
  const co = b.result.cohorts.find((c) => c.cohortId === cohortId);
  const model = b.model.cohorts.find((c) => c.id === cohortId);
  if (!co || !model) return <div className="empty">Cohort not found.</div>;
  const pp = (f: string) => b.prov(`cohorts.${cohortId}.${f}`);
  const policies = comparePolicies(model, b.model.fund.fundLifeYears);
  const ledger = b.result.ledger.filter((l) => l.cohortId === cohortId);
  return (
    <div>
      <table className="dense">
        <tbody>
          <tr><td>Companies</td><td className="n"><Val prov={pp('companyCount')}>{co.companyCount}</Val></td></tr>
          <tr><td>Initial ticket</td><td className="n"><Val prov={pp('entry.ticket')}>{money(model.entry.ticket, 2)}</Val></td></tr>
          <tr><td>Entry post-money</td><td className="n"><Val prov={pp('entry.postMoney')}>{money(model.entry.postMoney, 2)}</Val></td></tr>
          <tr><td>Entry ownership</td><td className="n"><Val prov={pp('entry.ownership')} tip={`ownership = ticket / post-money (${model.entry.derived} is derived)`}>{pct(co.entryOwnership, 2)}</Val></td></tr>
          <tr><td>Follow-on policy</td><td className="n">{model.followOn.kind.replace('_', ' ')}</td></tr>
          <tr><td>Dilution mode</td><td className="n">{model.dilutionMode}</td></tr>
          <tr><td>Invested (initial + follow-on)</td><td className="n">{money(co.initialInvested)} + {money(co.followOnInvested)}</td></tr>
          <tr><td>Proceeds · MOIC · IRR</td><td className="n">{money(co.proceeds)} · {mult(co.grossMoic)} · {irrFmt(co.grossIrr)}</td></tr>
        </tbody>
      </table>
      <h4>Outcome buckets</h4>
      <table className="dense">
        <thead><tr><th>Bucket</th><th className="n">Prob.</th><th className="n">Cos.</th><th className="n" data-tip="Rounds reached / follow-on per company">Rds · FO/co</th><th className="n">Exit own.</th><th className="n">Equity</th><th className="n">Proceeds</th></tr></thead>
        <tbody>
          {co.buckets.map((bk) => (
            <tr key={bk.bucketId} className="clickable" onClick={() => setDrill({ kind: 'bucket', scenarioId: b.scenario.id, cohortId, bucketId: bk.bucketId })}>
              <td>{bk.label}</td>
              <td className="n"><Val prov={pp(`buckets.${bk.bucketId}.probability`)}>{pct(bk.probability, 0)}</Val></td>
              <td className="n">{bk.expectedCompanies.toFixed(1)}</td>
              <td className="n">{bk.roundsReached} · {money(bk.followOnPerCompany, 2)}{bk.followOnPerCompanyRecipient !== undefined ? ` / ${money(bk.followOnPerCompanyRecipient, 2)}` : ''}</td>
              <td className="n">{pct(bk.exitOwnership)}{bk.exitOwnershipRecipient !== undefined ? ` / ${pct(bk.exitOwnershipRecipient)}` : ''}</td>
              <td className="n"><Val prov={pp(`buckets.${bk.bucketId}.exit`)}>{money(bk.equityValue, 0)}</Val></td>
              <td className="n">{money(bk.proceeds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Follow-on policy consequences</h4>
      <div className="small muted">Same cohort and market assumptions; only the policy changes.</div>
      <table className="dense">
        <thead><tr><th>Policy</th><th className="n">Follow-on</th><th className="n">Proceeds</th><th className="n">MOIC</th>{model.buckets.filter((x) => x.kind !== 'writeoff').map((x) => <th key={x.id} className="n" data-tip={`Blended exit ownership in ${x.label}`}>{x.label.split(' ')[0]} own.</th>)}</tr></thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.policy} className={p.isCurrent ? 'current' : ''}>
              <td>{p.label}{p.isCurrent ? ' (current)' : ''}{!p.available && <span className="warn small" data-tip={p.reason}> ⚠</span>}</td>
              <td className="n">{money(p.followOnInvested)}</td>
              <td className="n">{money(p.proceeds)}</td>
              <td className="n">{mult(p.grossMoic)}</td>
              {model.buckets.filter((x) => x.kind !== 'writeoff').map((x) => <td key={x.id} className="n">{pct(p.exitOwnershipByBucket[x.id])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Cash flows by year</h4>
      <LedgerByYear lines={ledger} />
    </div>
  );
}

function BucketDrill({ b, cohortId, bucketId }: { b: ScenarioBundle; cohortId: string; bucketId: string }) {
  const co = b.result.cohorts.find((c) => c.cohortId === cohortId);
  const bk = co?.buckets.find((x) => x.bucketId === bucketId);
  const mb = b.model.cohorts.find((c) => c.id === cohortId)?.buckets.find((x) => x.id === bucketId);
  if (!co || !bk || !mb) return <div className="empty">Bucket not found.</div>;
  const pp = (f: string) => b.prov(`cohorts.${cohortId}.buckets.${bucketId}.${f}`);
  const eq = exitEquityValue(mb.exit);
  return (
    <div>
      <div className="formula">
        Expected proceeds = {co.companyCount} cos × {pct(bk.probability, 1)} × {pct(bk.exitOwnership, 2)} own × {money(bk.equityValue)}m{bk.recipientShare > 0 ? ' (blended with follow-on recipients)' : ''} = <b>{money(bk.proceeds)}m</b>
      </div>
      <h4>Assumptions</h4>
      <table className="dense">
        <tbody>
          <ProvRow k="Probability" v={pct(mb.probability, 1)} p={pp('probability')} />
          <ProvRow k="Years to exit" v={`${mb.yearsToExit} (fund years ${bk.exitYears.join(', ')})`} p={pp('yearsToExit')} />
          {mb.exit.mode === 'equity' ? (
            <ProvRow k="Equity exit value" v={money(mb.exit.equityValue)} p={pp('exit')} />
          ) : (
            <>
              <ProvRow k="Revenue × multiple" v={`${money(mb.exit.revenue)} × ${mb.exit.multiple}× = EV ${money(eq.enterprise)}`} p={pp('exit')} />
              <ProvRow k={mb.exit.netDebt >= 0 ? '− Net debt' : '+ Net cash'} v={money(Math.abs(mb.exit.netDebt))} p={pp('exit')} />
              <ProvRow k="= Equity value" v={money(eq.equity)} p={pp('exit')} />
            </>
          )}
          <ProvRow k="Rounds reached" v={String(mb.roundsReached)} p={pp('roundsReached')} />
          <ProvRow k="Cumulative / extra dilution" v={pct(mb.cumulativeDilution)} p={pp('cumulativeDilution')} />
        </tbody>
      </table>
      <h4>Ownership path {bk.ownershipPathRecipient ? '(non-recipients)' : ''}</h4>
      <PathTable steps={bk.ownershipPath} />
      {bk.ownershipPathRecipient && (
        <>
          <h4>Ownership path (fixed follow-on recipients, {pct(bk.recipientShare, 0)} of bucket)</h4>
          <PathTable steps={bk.ownershipPathRecipient} />
        </>
      )}
      <h4>Cash flows</h4>
      <LedgerByYear lines={b.result.ledger.filter((l) => l.cohortId === cohortId && l.bucketId === bucketId)} />
    </div>
  );
}

const ProvRow = ({ k, v, p }: { k: string; v: string; p: ReturnType<ScenarioBundle['prov']> }) => (
  <tr>
    <td>{k}</td>
    <td className="n"><Val prov={p}>{v}</Val></td>
    <td className="small"><span className={provClass(p)}>{p?.kind ?? 'default'}</span></td>
  </tr>
);

function PathTable({ steps }: { steps: OwnershipStep[] }) {
  return (
    <table className="dense">
      <thead><tr><th>Step</th><th className="n">Yr</th><th className="n">Dilution</th><th className="n">Invested/co</th><th className="n">Ownership</th></tr></thead>
      <tbody>
        {steps.length ? steps.map((s, i) => (
          <tr key={i}><td>{s.label}</td><td className="n">+{s.year}</td><td className="n">{pct(s.dilution)}</td><td className="n">{s.invested ? money(s.invested, 2) : '—'}</td><td className="n">{pct(s.ownershipBefore, 2)} → {pct(s.ownershipAfter, 2)}</td></tr>
        )) : <tr><td colSpan={5} className="muted">No dilution steps — ownership unchanged to exit.</td></tr>}
      </tbody>
    </table>
  );
}

function LedgerByYear({ lines }: { lines: CashFlowLine[] }) {
  const years = [...new Set(lines.map((l) => l.year))].sort((a, z) => a - z);
  const sum = (y: number, k: CashFlowLine['kind']) => lines.filter((l) => l.year === y && l.kind === k).reduce((a, l) => a + l.amount, 0);
  return (
    <table className="dense">
      <thead><tr><th className="n">Yr</th><th className="n">Initial</th><th className="n">Follow-on</th><th className="n">Proceeds</th><th className="n">Net</th></tr></thead>
      <tbody>
        {years.map((y) => {
          const i = sum(y, 'initial'), f = sum(y, 'follow_on'), p = sum(y, 'proceeds');
          return <tr key={y}><td className="n">{y}</td><td className="n">{money(i)}</td><td className="n">{money(f)}</td><td className="n">{money(p)}</td><td className="n">{money(i + f + p)}</td></tr>;
        })}
      </tbody>
    </table>
  );
}

function YearDrill({ b, year }: { b: ScenarioBundle; year: number }) {
  const setDrill = useStore((s) => s.setDrill);
  const a = b.result.annual[year];
  const lines = b.result.ledger.filter((l) => l.year === year);
  const key = (l: CashFlowLine) => `${l.kind}|${l.cohortId ?? ''}|${l.bucketId ?? ''}|${l.roundId ?? ''}`;
  const agg = new Map<string, { l: CashFlowLine; amount: number; companies: number }>();
  for (const l of lines) {
    const k = key(l);
    const cur = agg.get(k) ?? { l, amount: 0, companies: 0 };
    cur.amount += l.amount;
    cur.companies += l.companies ?? 0;
    agg.set(k, cur);
  }
  const label = (id?: string) => b.result.cohorts.find((c) => c.cohortId === id)?.label ?? '';
  const blabel = (cid?: string, bid?: string) => b.result.cohorts.find((c) => c.cohortId === cid)?.buckets.find((x) => x.bucketId === bid)?.label ?? '';
  return (
    <div>
      {a && (
        <table className="dense">
          <tbody>
            <Row k="Initial investments" v={money(a.initialInvestment)} />
            <Row k="Follow-on investments" v={money(a.followOnInvestment)} />
            <Row k="Fees" v={money(a.fees)} />
            <Row k="Paid-in" v={money(a.paidIn)} />
            <Row k="Gross proceeds" v={money(a.grossProceeds)} />
            <Row k="LP distributions / GP carry" v={`${money(a.lpDistributions)} / ${money(a.gpCarry)}`} />
            <Row k="Net invested capital (year end)" v={money(a.netInvestedCapital)} />
            <Row k="Cumulative LP net" v={money(a.cumulativeLpNetFlow)} />
          </tbody>
        </table>
      )}
      <h4>Cash-flow lines (expected, aggregated across vintages)</h4>
      <table className="dense">
        <thead><tr><th>Type</th><th>Cohort / bucket</th><th className="n">Cos.</th><th className="n">Amount</th></tr></thead>
        <tbody>
          {[...agg.values()].sort((x, y) => x.amount - y.amount).map(({ l, amount, companies }) => (
            <tr key={key(l)} className={l.cohortId ? 'clickable' : ''} onClick={() => l.cohortId && l.bucketId && setDrill({ kind: 'bucket', scenarioId: b.scenario.id, cohortId: l.cohortId, bucketId: l.bucketId })}>
              <td>{l.kind.replace('_', ' ')}{l.roundId ? ` (${l.roundId})` : ''}</td>
              <td>{l.cohortId ? `${label(l.cohortId)} / ${blabel(l.cohortId, l.bucketId)}` : 'Fund'}</td>
              <td className="n">{companies ? companies.toFixed(2) : ''}</td>
              <td className="n">{money(amount, 2)}</td>
            </tr>
          ))}
          {!agg.size && <tr><td colSpan={4} className="muted">No cash flows in this year.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function IssuesList({ b }: { b: ScenarioBundle }) {
  const all = [...b.resolveIssues, ...b.result.issues];
  if (!all.length) return <div className="muted">No validation messages.</div>;
  return (
    <ul className="issues">
      {all.map((i, k) => (
        <li key={k} className={`issue-${i.severity}`}>
          <span className="badge">{i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'} {i.severity}</span> {i.message}
          {i.path && <div className="muted small mono">{i.path}</div>}
        </li>
      ))}
    </ul>
  );
}
