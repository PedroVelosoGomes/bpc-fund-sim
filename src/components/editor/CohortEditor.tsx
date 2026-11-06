import { resolveEntry, roundDilution, type CohortModel, type CohortStrategy, type EntryField, type RoundSpec } from '../../../engine';
import type { ScenarioBundle } from '../../state/results';
import { useStore } from '../../state/store';
import { NumField, Section, Select, TextField, Val } from '../fields';
import { money, mult, pct } from '../../lib/format';
import { BucketEditor } from './BucketEditor';
import { ConfirmButton } from '../ConfirmButton';

export function CohortsEditor({ b }: { b: ScenarioBundle }) {
  const { addCohort } = useStore.getState();
  return (
    <Section title={`Cohorts (${b.strategy.cohorts.length})`} right={<button className="small" onClick={() => addCohort(b.scenario.id)}>+ Cohort</button>}>
      {b.strategy.cohorts.map((c) => (
        <CohortEditor key={c.id} b={b} c={c} />
      ))}
    </Section>
  );
}

function CohortEditor({ b, c }: { b: ScenarioBundle; c: CohortStrategy }) {
  const sid = b.scenario.id;
  const { editStrategy, setCohortOverride, removeCohort, setDrill } = useStore.getState();
  const model = b.model.cohorts.find((x) => x.id === c.id);
  const res = b.result.cohorts.find((x) => x.cohortId === c.id);
  const p = (k: string) => b.prov(`cohorts.${c.id}.${k}`);
  const edit = (paths: string[], fn: (x: CohortStrategy) => void) =>
    editStrategy(sid, (s) => {
      const x = s.cohorts.find((y) => y.id === c.id);
      if (x) fn(x);
    }, paths.map((k) => `cohorts.${c.id}.${k}`));
  const overridden = !!b.scenario.cohortOverrides[c.id];
  const profiles = b.marketCase.profiles;

  const entry = resolveEntry(c.entry);
  const setEntry = (field: EntryField, v: number) =>
    edit([`entry.${field}`], (x) => {
      x.entry = resolveEntry({ ...x.entry, [field]: v });
    });
  const entryField = (field: EntryField, label: string, unit: 'm' | '%') =>
    c.entry.derived === field ? (
      <div className="field">
        <span className="field-label">{label} <span className="derived-tag">derived</span></span>
        <Val prov={p(`entry.${field}`)} tip={`Derived: ownership = ticket / post-money.\nSet any two; the third follows.`}>
          {unit === '%' ? pct(entry[field], 2) : `${money(entry[field], 2)}m`}
        </Val>
      </div>
    ) : (
      <NumField label={label} unit={unit} value={entry[field]} prov={p(`entry.${field}`)} min={0} onCommit={(v) => setEntry(field, v)} />
    );

  return (
    <div className="cohort">
      <div className="cohort-head">
        <TextField value={c.label} onCommit={(v) => edit([], (x) => (x.label = v))} />
        {res && (
          <button className="link n" onClick={() => setDrill({ kind: 'cohort', scenarioId: sid, cohortId: c.id })} data-tip="Inspect cohort: buckets, ownership paths, cash flows, policy consequences">
            {money(res.invested)}m → {money(res.proceeds)}m · {mult(res.grossMoic)}
          </button>
        )}
        <ConfirmButton className="icon" tip="Remove cohort" confirmLabel="Remove?" onConfirm={() => removeCohort(sid, c.id)}>✕</ConfirmButton>
      </div>
      <div className="grid3">
        <NumField label="Companies" unit="#" value={c.companyCount} prov={p('companyCount')} min={0} onCommit={(v) => edit(['companyCount'], (x) => (x.companyCount = v))} />
        <Select label="Market profile" value={c.marketProfileId} options={profiles.map((m) => ({ value: m.id, label: m.label }))} onChange={(v) => edit([], (x) => {
          x.marketProfileId = v;
          const prof = profiles.find((m) => m.id === v);
          if (prof) { x.stage = prof.stage; x.geography = prof.geography; }
        })} tip="Entry stage / geography profile in the scenario's market case. Supplies rounds, dilution and outcome buckets." />
        <Select label="Sleeve" value={c.sleeveId ?? ''} options={[{ value: '', label: '—' }, ...b.strategy.fund.sleeves.filter((s) => s.use === 'direct').map((s) => ({ value: s.id, label: s.label }))]} onChange={(v) => edit([], (x) => (x.sleeveId = v || undefined))} />
      </div>
      <div className="grid3">
        {entryField('ticket', 'Initial ticket', 'm')}
        {entryField('postMoney', 'Entry post-money', 'm')}
        {entryField('ownership', 'Entry ownership', '%')}
      </div>
      <div className="row small muted">
        Derive:
        {(['ticket', 'postMoney', 'ownership'] as EntryField[]).map((f) => (
          <label key={f} className="radio">
            <input type="radio" checked={c.entry.derived === f} onChange={() => edit([], (x) => (x.entry = resolveEntry({ ...x.entry, derived: f })))} /> {f === 'postMoney' ? 'post-money' : f}
          </label>
        ))}
      </div>

      <Deployment c={c} prov={p('deployment')} onChange={(d) => edit(['deployment'], (x) => (x.deployment = d))} />
      {model && <FollowOn c={c} model={model} prov={p('followOn')} onChange={(f) => edit(['followOn'], (x) => (x.followOn = f))} />}

      {model && (
        <div className="market-block">
          <div className="row">
            <span className="small">Market assumptions — <span className={`case case-${b.marketCase.kind}`}>{b.marketCase.name}</span></span>
            <span className="spacer" />
            {overridden && (
              <>
                <span className="badge user" data-tip="This scenario overrides the market case for this cohort. The shared market case is unchanged.">override</span>
                <button className="small" onClick={() => setCohortOverride(sid, c.id, null, [])}>Revert to market case</button>
              </>
            )}
          </div>
          <Select
            label="Dilution mode"
            value={model.dilutionMode}
            options={[{ value: 'quick', label: 'Quick (cumulative per bucket)' }, { value: 'explicit', label: 'Explicit (round by round)' }]}
            onChange={(v) => setCohortOverride(sid, c.id, { dilutionMode: v }, [`cohorts.${c.id}.dilutionMode`])}
          />
          <RoundsEditor b={b} cohortId={c.id} rounds={model.rounds} />
          <BucketEditor b={b} cohort={model} />
        </div>
      )}
    </div>
  );
}

function Deployment({ c, prov, onChange }: { c: CohortStrategy; prov: ReturnType<ScenarioBundle['prov']>; onChange: (d: CohortStrategy['deployment']) => void }) {
  const d = c.deployment;
  const sum = d.mode === 'spread' ? d.weights.reduce((a, x) => a + x, 0) : 1;
  return (
    <div className="sub">
      <div className="row">
        <Select label="Deployment" value={d.mode} options={[{ value: 'single', label: 'Single entry year' }, { value: 'spread', label: '% of companies per year' }]} onChange={(m) => onChange(m === 'single' ? { mode: 'single', entryYear: 0 } : { mode: 'spread', weights: [0.25, 0.25, 0.25, 0.25] })} />
        {d.mode === 'single' && <NumField label="Entry year" unit="yrs" integer min={0} value={d.entryYear} prov={prov} onCommit={(v) => onChange({ mode: 'single', entryYear: v })} />}
      </div>
      {d.mode === 'spread' && (
        <div className="row wrap">
          {d.weights.map((w, i) => (
            <NumField key={i} label={`Y${i}`} unit="%" width={44} value={w} prov={prov} min={0} max={1} invalid={Math.abs(sum - 1) > 1e-6} onCommit={(v) => onChange({ mode: 'spread', weights: d.weights.map((x, j) => (j === i ? v : x)) })} />
          ))}
          <button className="small" onClick={() => onChange({ mode: 'spread', weights: [...d.weights, 0] })}>+ year</button>
          {d.weights.length > 1 && <button className="small" onClick={() => onChange({ mode: 'spread', weights: d.weights.slice(0, -1) })}>− year</button>}
          <span className={`small ${Math.abs(sum - 1) > 1e-6 ? 'bad' : 'muted'}`}>Σ {pct(sum)}</span>
        </div>
      )}
    </div>
  );
}

function FollowOn({ c, model, prov, onChange }: { c: CohortStrategy; model: CohortModel; prov: ReturnType<ScenarioBundle['prov']>; onChange: (f: CohortStrategy['followOn']) => void }) {
  const f = c.followOn;
  const defaultBuckets = model.buckets.filter((x) => x.kind === 'strong' || x.kind === 'outlier').map((x) => x.id);
  return (
    <div className="sub">
      <Select
        label="Follow-on policy"
        value={f.kind}
        options={[{ value: 'none', label: 'None' }, { value: 'pro_rata', label: 'Pro rata (hold ownership in reached rounds)' }, { value: 'fixed', label: 'Fixed ticket into selected buckets' }]}
        onChange={(k) => onChange(k === 'fixed' ? { kind: 'fixed', ticket: c.entry.ticket, fractionOfCohort: 0.2, bucketIds: defaultBuckets, roundIndex: 0 } : { kind: k })}
        tip="Follow-on capital is only deployed into rounds an outcome bucket actually reaches."
      />
      {f.kind === 'fixed' && (
        <>
          <div className="grid3">
            <NumField label="Ticket / company" unit="m" value={f.ticket} prov={prov} min={0} onCommit={(v) => onChange({ ...f, ticket: v })} />
            <NumField label="% of cohort" unit="%" value={f.fractionOfCohort} prov={prov} min={0} max={1} onCommit={(v) => onChange({ ...f, fractionOfCohort: v })} />
            <Select label="In round" value={String(f.roundIndex)} options={model.rounds.length ? model.rounds.map((r, i) => ({ value: String(i), label: r.label })) : [{ value: '0', label: '(no rounds)' }]} onChange={(v) => onChange({ ...f, roundIndex: Number(v) })} />
          </div>
          <div className="row small wrap">
            Receiving buckets:
            {model.buckets.map((bk) => (
              <label key={bk.id} className="radio">
                <input type="checkbox" checked={f.bucketIds.includes(bk.id)} onChange={(e) => onChange({ ...f, bucketIds: e.target.checked ? [...f.bucketIds, bk.id] : f.bucketIds.filter((x) => x !== bk.id) })} /> {bk.label}
              </label>
            ))}
          </div>
        </>
      )}
      {f.kind !== 'none' && model.rounds.length === 0 && <div className="small warn">No modelled rounds — add rounds below for follow-ons to deploy.</div>}
    </div>
  );
}

function RoundsEditor({ b, cohortId, rounds }: { b: ScenarioBundle; cohortId: string; rounds: RoundSpec[] }) {
  const set = (next: RoundSpec[]) => useStore.getState().setCohortOverride(b.scenario.id, cohortId, { rounds: next }, [`cohorts.${cohortId}.rounds`]);
  const prov = b.prov(`cohorts.${cohortId}.rounds`);
  return (
    <div className="sub">
      <div className="row">
        <span className="field-label">Round schedule (used for follow-on cash; explicit-mode dilution)</span>
        <span className="spacer" />
        <button className="small" onClick={() => set([...rounds, { id: `r-${Date.now().toString(36)}`, label: `Round ${rounds.length + 1}`, yearFromEntry: (rounds.at(-1)?.yearFromEntry ?? 0) + 2, size: 10, postMoney: 50 }])}>+ round</button>
      </div>
      {rounds.length > 0 && (
        <table className="dense">
          <thead>
            <tr><th>Round</th><th className="n" data-tip="Years after the company's entry">Yr</th><th className="n">Size</th><th className="n">Post</th><th className="n" data-tip="Round dilution = size / post-money">Dil.</th><th /></tr>
          </thead>
          <tbody>
            {rounds.map((r, i) => {
              const upd = (patch: Partial<RoundSpec>) => set(rounds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const d = roundDilution(r);
              return (
                <tr key={r.id}>
                  <td><TextField value={r.label} width={72} onCommit={(v) => upd({ label: v })} /></td>
                  <td className="n"><NumField width={30} integer min={1} value={r.yearFromEntry} prov={prov} onCommit={(v) => upd({ yearFromEntry: v })} /></td>
                  <td className="n"><NumField width={44} value={r.size} min={0} prov={prov} onCommit={(v) => upd({ size: v })} /></td>
                  <td className="n"><NumField width={48} value={r.postMoney} min={0.01} prov={prov} onCommit={(v) => upd({ postMoney: v })} /></td>
                  <td className={`n ${d > 0 && d < 1 ? '' : 'bad'}`}>{pct(d)}</td>
                  <td><button className="icon" onClick={() => set(rounds.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
