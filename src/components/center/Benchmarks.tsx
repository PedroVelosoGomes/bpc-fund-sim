import { useMemo, useRef, useState } from 'react';
import {
  applyEntryBenchmarks,
  BENCHMARK_CSV_TEMPLATE,
  DEFAULT_CASE_MAPPING,
  evaluateFund,
  generateBenchmarkCases,
  listAssumptions,
  mappingKeyFor,
  MAPPING_LABEL,
  matchBenchmarks,
  METRIC_LABEL,
  METRIC_UNIT,
  normalizeRow,
  resolveScenario,
  type AssumptionMatch,
  type AssumptionRef,
  type BenchmarkPack,
  type CaseMapping,
  type Issue,
  type MappingKey,
  type MarketCase,
  type NormalizedRow,
  type Point,
} from '../../../engine';
import { useStore } from '../../state/store';
import { parsePackText, samplePack } from '../../lib/benchmarks';
import { money, mult, pct } from '../../lib/format';
import { Select, Toggle } from '../fields';
import { ConfirmButton } from '../ConfirmButton';

type Step = 'source' | 'match' | 'generate';

const fmtVal = (metric: AssumptionRef['metric'], v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (METRIC_UNIT[metric]) {
    case 'money':
      return money(v, v < 10 ? 2 : 0);
    case 'rate':
      return pct(v, 1);
    case 'years':
      return `${+v.toFixed(2)}y`;
    case 'multiple':
      return `${v.toFixed(1)}×`;
  }
};

const sevIcon = (s: Issue['severity']) => (s === 'error' ? '✕' : s === 'warning' ? '!' : 'i');

function Flags({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const worst = issues.some((i) => i.severity === 'error') ? 'error' : issues.some((i) => i.severity === 'warning') ? 'warning' : 'info';
  return (
    <span className={`flag flag-${worst}`} data-tip={issues.map((i) => `${sevIcon(i.severity)} ${i.message}`).join('\n')}>
      {sevIcon(worst)} {issues.length}
    </span>
  );
}

export function Benchmarks() {
  const ws = useStore((s) => s.ws);
  const activePackId = useStore((s) => s.activePackId);
  const focusedId = useStore((s) => s.ui.focusedId);
  const { addBenchmarkPack, deleteBenchmarkPack, setActivePack } = useStore.getState();
  const packs = Object.values(ws.benchmarks);
  const pack = activePackId ? ws.benchmarks[activePackId] : packs[0];
  const [step, setStep] = useState<Step>('source');

  return (
    <div className="bench">
      <nav className="steps">
        {(['source', 'match', 'generate'] as Step[]).map((s, i) => (
          <button key={s} className={step === s ? 'active' : ''} disabled={s !== 'source' && !pack} onClick={() => setStep(s)}>
            {i + 1}. {s === 'source' ? 'Import & review rows' : s === 'match' ? 'Match & preview changes' : 'Generate cases'}
          </button>
        ))}
      </nav>
      {step === 'source' && <SourceStep packs={packs} pack={pack} onAdd={(p) => addBenchmarkPack(p)} onSelect={setActivePack} onDelete={deleteBenchmarkPack} onNext={() => setStep('match')} />}
      {step !== 'source' && pack && <MatchAndGenerate key={pack.id} pack={pack} step={step} setStep={setStep} focusedId={focusedId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

function SourceStep(props: { packs: BenchmarkPack[]; pack?: BenchmarkPack; onAdd: (p: BenchmarkPack) => void; onSelect: (id: string) => void; onDelete: (id: string) => void; onNext: () => void }) {
  const currency = useStore((s) => {
    const sc = s.ui.focusedId ? s.ws.scenarios[s.ui.focusedId] : undefined;
    return (sc && s.ws.strategies[sc.strategyId]?.fund.currency) ?? 'EUR';
  });
  const [percentile, setPercentile] = useState(false);
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const templateUrl = useMemo(() => URL.createObjectURL(new Blob([BENCHMARK_CSV_TEMPLATE], { type: 'text/csv' })), []);

  const onFile = async (f: File) => {
    const text = await f.text();
    props.onAdd(parsePackText(text, f.name.replace(/\.(csv|json)$/i, ''), percentile));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BENCHMARK_CSV_TEMPLATE);
      setCopied('Template copied');
    } catch {
      const sel = window.getSelection();
      const r = document.createRange();
      if (preRef.current) {
        r.selectNodeContents(preRef.current);
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      setCopied('Selected — press Ctrl/⌘+C to copy');
    }
  };

  return (
    <div className="grid-bench">
      <div className="bench-col">
        <h4>Import a pack</h4>
        <div className="row wrap gap">
          <button className="primary" onClick={() => fileRef.current?.click()}>Choose CSV or JSON file…</button>
          <input ref={fileRef} id="bench-file" type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button onClick={() => props.onAdd(samplePack())} data-tip="Invented values that exercise ties, currency and unit flags. Not real market data.">Load illustrative sample pack</button>
        </div>
        <Toggle label="Source reports low / base / high as percentiles" checked={percentile} onChange={setPercentile} tip="Only tick this when the source explicitly publishes percentiles (e.g. P25/P50/P75). Otherwise generated cases are labelled as assumption bundles." />
        <details>
          <summary className="small">Paste CSV or JSON instead</summary>
          <textarea id="bench-paste" className="paste" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="metric,stage,geography,vintage,unit,low,base,high,source,as_of,notes" />
          <button className="small" disabled={!paste.trim()} onClick={() => props.onAdd(parsePackText(paste, `Pasted pack ${new Date().toLocaleDateString()}`, percentile))}>Parse pasted text</button>
        </details>
        <h4>Template</h4>
        <div className="row wrap gap">
          <a className="button-like small" href={templateUrl} download="benchmark-template.csv" data-tip="Downloads where the browser allows it. If nothing happens, use Copy.">Download CSV template</a>
          <button className="small" onClick={copy}>Copy template</button>
          {copied && <span className="small muted">{copied}</span>}
        </div>
        <details>
          <summary className="small">Show template and schema</summary>
          <pre ref={preRef} className="template">{BENCHMARK_CSV_TEMPLATE}</pre>
        </details>

        <h4>Packs in this workspace</h4>
        {props.packs.length === 0 && <div className="muted small">No packs yet.</div>}
        <table className="dense">
          <tbody>
            {props.packs.map((p) => (
              <tr key={p.id} className={`clickable ${props.pack?.id === p.id ? 'focused-row' : ''}`} onClick={() => props.onSelect(p.id)}>
                <td>
                  {p.name}
                  <div className="muted small">{p.rows.length} rows · {p.format.toUpperCase()} · {new Date(p.importedAt).toLocaleDateString()}{p.percentileBacked ? ' · percentiles' : ''}</div>
                </td>
                <td className="actions" onClick={(e) => e.stopPropagation()}>
                  <ConfirmButton className="icon" tip="Remove pack (generated cases are kept)" confirmLabel="Remove?" onConfirm={() => props.onDelete(p.id)}>✕</ConfirmButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bench-col wide">
        {!props.pack ? (
          <div className="empty">Import a pack or load the illustrative sample to review its rows.</div>
        ) : (
          <PackRows pack={props.pack} currency={currency} onNext={props.onNext} />
        )}
      </div>
    </div>
  );
}

function PackRows({ pack, currency, onNext }: { pack: BenchmarkPack; currency: string; onNext: () => void }) {
  const rows = pack.rows.map((r) => normalizeRow(r, currency));
  const blocked = rows.filter((r) => !r.usable).length;
  const flagged = rows.filter((r) => r.usable && r.issues.some((i) => i.severity === 'warning')).length;
  const errors = pack.parseIssues.filter((i) => i.severity === 'error');
  return (
    <>
      <div className="row">
        <h4 style={{ margin: 0 }}>{pack.name}</h4>
        <span className="spacer" />
        <button className="primary" disabled={!rows.some((r) => r.usable)} onClick={onNext}>Next: match & preview →</button>
      </div>
      <div className="chips">
        <span className="chip-stat">{rows.length} rows</span>
        <span className={`chip-stat ${blocked ? 'bad' : ''}`}>{blocked} blocked</span>
        <span className={`chip-stat ${flagged ? 'warn' : ''}`}>{flagged} flagged</span>
        <span className={`chip-stat ${errors.length ? 'bad' : ''}`}>{errors.length} skipped at parse</span>
        <span className="chip-stat">fund currency {currency}</span>
        <span className="chip-stat">{pack.percentileBacked ? 'percentile source' : 'not percentiles'}</span>
      </div>
      {pack.parseIssues.length > 0 && (
        <ul className="issues small">
          {pack.parseIssues.map((i, k) => <li key={k} className={`issue-${i.severity}`}>{sevIcon(i.severity)} {i.message}</li>)}
        </ul>
      )}
      <div className="table-scroll">
        <table className="dense rows-table">
          <thead>
            <tr>
              <th className="n">#</th><th>Metric</th><th>Stage</th><th>Geo</th><th className="n">Vintage</th><th>Unit</th>
              <th className="n">Low</th><th className="n">Base</th><th className="n">High</th>
              <th className="n" data-tip={`Base value in model units (${currency} millions, %, years, ×)`}>Model base</th>
              <th>Source · as of</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.usable ? '' : 'blocked'}>
                <td className="n">{r.rowNumber}</td>
                <td className="mono small">{r.metric}</td>
                <td>{r.stage}</td>
                <td>{r.geography || '—'}</td>
                <td className="n">{r.vintage ?? '—'}</td>
                <td className="mono small">{r.unit}</td>
                <td className="n">{r.low}</td>
                <td className="n">{r.base}</td>
                <td className="n">{r.high}</td>
                <td className="n">{r.usable ? fmtVal(r.baseMetric, r.value.base) : 'blocked'}</td>
                <td className="small" data-tip={r.notes || undefined}>{r.source} · {r.asOf}</td>
                <td><Flags issues={r.issues} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Steps 2 & 3
// ---------------------------------------------------------------------------

function MatchAndGenerate({ pack, step, setStep, focusedId }: { pack: BenchmarkPack; step: Step; setStep: (s: Step) => void; focusedId?: string }) {
  const ws = useStore((s) => s.ws);
  const scenarios = ws.scenarioOrder.map((id) => ws.scenarios[id]).filter(Boolean);
  const cases = Object.values(ws.marketCases);
  const focused = focusedId ? ws.scenarios[focusedId] : scenarios[0];
  const [structureId, setStructureId] = useState<string>(() => (focused && ws.marketCases[focused.marketCaseId]?.kind === 'base' ? focused.marketCaseId : cases.find((c) => c.kind === 'base')?.id ?? cases[0]?.id));
  const [targets, setTargets] = useState<string[]>(focused ? [focused.id] : []);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<CaseMapping>(DEFAULT_CASE_MAPPING);
  const [residuals, setResiduals] = useState<Record<string, string>>({});
  const [prefix, setPrefix] = useState(pack.name);
  const [applyEntry, setApplyEntry] = useState(true);
  const [createFrom, setCreateFrom] = useState<string>(focused?.id ?? '');
  const [saved, setSaved] = useState<string | null>(null);

  const structure = ws.marketCases[structureId];
  const fundOf = (scId?: string) => (scId ? ws.strategies[ws.scenarios[scId]?.strategyId]?.fund : undefined);
  const refFund = fundOf(focused?.id) ?? fundOf(scenarios[0]?.id);
  const currency = refFund?.currency ?? 'EUR';
  const vintage = refFund?.vintageYear;

  const refs = useMemo(() => {
    if (!structure) return [];
    const cohorts = targets.flatMap((id) => {
      const st = ws.strategies[ws.scenarios[id]?.strategyId];
      return st ? st.cohorts.map((cohort) => ({ cohort, strategyName: ws.scenarios[id].name, strategyId: st.id })) : [];
    });
    return listAssumptions(structure.profiles, cohorts);
  }, [structure, targets, ws.strategies, ws.scenarios]);

  const match = useMemo(() => matchBenchmarks(pack, refs, { fundCurrency: currency, fundVintage: vintage, selections }), [pack, refs, currency, vintage, selections]);

  const gen = useMemo(
    () => (structure ? generateBenchmarkCases(structure, match, pack, { mapping, residuals, idFor: (k) => `mc-${pack.id}-${k}`, namePrefix: prefix }) : undefined),
    [structure, match, pack, mapping, residuals, prefix],
  );

  if (!structure) return <div className="empty">No market case to use as a structure. Load the demo data first.</div>;

  const entryUpdates = applyEntry
    ? targets.map((id) => {
        const st = ws.strategies[ws.scenarios[id].strategyId];
        return { scenarioId: id, ...applyEntryBenchmarks(st, match, pack) };
      }).filter((u) => u.changed.length)
    : [];

  const save = () => {
    if (!gen?.valid) return;
    const stamp = Date.now().toString(36);
    const cs: MarketCase[] = gen.cases.map((c) => ({ ...c.marketCase, id: `${c.marketCase.id}-${stamp}` }));
    const created = useStore.getState().saveBenchmarkCases({ cases: cs, strategyUpdates: entryUpdates.map((u) => ({ scenarioId: u.scenarioId, strategy: u.strategy })), createFromScenarioId: createFrom || undefined });
    setSaved(created.length ? `Saved 3 market cases and ${created.length} scenarios. They are now compared.` : 'Saved 3 market cases. Switch any scenario to them from the list.');
  };

  return (
    <div>
      <div className="row wrap controls">
        <Select label="Structure (buckets, rounds) from market case" value={structureId} options={cases.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setStructureId(v)} tip="The generated cases copy this case's bucket layout and round schedule; benchmark rows overwrite the values they match. Unmatched values keep this case's value and provenance." />
        <div className="field">
          <span className="field-label">Apply entry benchmarks (ticket, post-money, ownership) to</span>
          <div className="row wrap">
            {scenarios.map((s) => (
              <label key={s.id} className="radio">
                <input type="checkbox" checked={targets.includes(s.id)} onChange={(e) => setTargets(e.target.checked ? [...targets, s.id] : targets.filter((x) => x !== s.id))} /> {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="chips">
        <span className="chip-stat">{match.matches.filter((m) => m.selected).length} matched</span>
        <span className={`chip-stat ${match.ties.length ? 'bad' : ''}`}>{match.ties.length} ties to resolve</span>
        <span className={`chip-stat ${match.unmatched.length ? 'warn' : ''}`}>{match.unmatched.length} without a benchmark</span>
        <span className="chip-stat">{match.unusedRows.length} rows unused</span>
        <span className="chip-stat">vintage {vintage ?? 'not set'} · {currency}</span>
      </div>

      {step === 'match' && <MatchStep match={match} selections={selections} setSelections={setSelections} onNext={() => setStep('generate')} />}
      {step === 'generate' && gen && (
        <GenerateStep
          pack={pack}
          structure={structure}
          match={match}
          gen={gen}
          mapping={mapping}
          setMapping={setMapping}
          residuals={residuals}
          setResiduals={setResiduals}
          prefix={prefix}
          setPrefix={setPrefix}
          applyEntry={applyEntry}
          setApplyEntry={setApplyEntry}
          entryChanges={entryUpdates.reduce((a, u) => a + u.changed.length, 0)}
          entryStrategyCount={entryUpdates.length}
          createFrom={createFrom}
          setCreateFrom={setCreateFrom}
          scenarios={scenarios.map((s) => ({ id: s.id, name: s.name }))}
          onSave={save}
          saved={saved}
          previewStrategy={createFrom ? (entryUpdates.find((u) => u.scenarioId === createFrom)?.strategy ?? ws.strategies[ws.scenarios[createFrom].strategyId]) : undefined}
        />
      )}
    </div>
  );
}

function MatchStep({ match, selections, setSelections, onNext }: { match: ReturnType<typeof matchBenchmarks>; selections: Record<string, string>; setSelections: (s: Record<string, string>) => void; onNext: () => void }) {
  const groups = new Map<string, AssumptionMatch[]>();
  for (const m of match.matches) {
    const k = `${m.ref.targetKind === 'profile' ? 'Market profile' : 'Cohort entry'} · ${m.ref.targetLabel}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const choose = (key: string, rowId: string) => setSelections({ ...selections, [key]: rowId });
  const tiesAll = match.matches.filter((m) => m.tiedRowIds.length > 1);
  return (
    <>
      {tiesAll.length > 0 && (
        <div className={`callout ${match.ties.length ? 'bad-callout' : ''}`}>
          {match.ties.length ? (
            <b>{match.ties.length} assumption(s) match several equally ranked rows. Choose one for each before generating cases.</b>
          ) : (
            <b>Tied rows resolved by your choice.</b>
          )}
          {tiesAll.map((t) => (
            <div key={t.ref.key} className="tie">
              <div className="small"><b>{t.ref.targetLabel}</b> · {label(t.ref)} {t.tie ? <span className="bad">— choose one</span> : <span className="muted">— chosen</span>}</div>
              {t.candidates.filter((c) => t.tiedRowIds.includes(c.row.id)).map((c) => (
                <label key={c.row.id} className="radio block">
                  <input type="radio" name={`tie-${t.ref.key}`} id={`tie-${t.ref.key}-${c.row.id}`} checked={selections[t.ref.key] === c.row.id} onChange={() => choose(t.ref.key, c.row.id)} />
                  row {c.row.rowNumber}: {fmtVal(c.row.baseMetric, c.row.value.low)} / <b>{fmtVal(c.row.baseMetric, c.row.value.base)}</b> / {fmtVal(c.row.baseMetric, c.row.value.high)} · {c.row.source} · {c.row.asOf}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {match.issues.length > 0 && (
        <ul className="issues small">
          {match.issues.map((i, k) => <li key={k} className={`issue-${i.severity}`}>{sevIcon(i.severity)} {i.message}</li>)}
        </ul>
      )}
      <div className="row">
        <h4>Preview: current value → benchmark base</h4>
        <span className="spacer" />
        <button className="primary" disabled={match.ties.length > 0} onClick={onNext} data-tip={match.ties.length ? 'Resolve ties first' : undefined}>Next: generate cases →</button>
      </div>
      <div className="muted small">Nothing is applied yet. Matching: stage, then geography, then vintage closest to the fund's; bucket-specific rows beat unsuffixed rows.</div>
      <div className="table-scroll">
        <table className="dense match-table">
          <thead>
            <tr><th>Assumption</th><th className="n">Current</th><th className="n">Benchmark base</th><th className="n">Low – high</th><th className="n">Δ</th><th>Matched row</th><th>Flags</th></tr>
          </thead>
          {[...groups.entries()].map(([g, ms]) => (
            <tbody key={g}>
              <tr className="group"><td colSpan={7}>{g}</td></tr>
              {ms.map((m) => {
                const s = m.selected;
                const isRange = m.ref.metric === 'entry_post_money' && m.ref.targetKind === 'profile';
                const rangeChanged = isRange && s && (!m.ref.currentRange || Math.abs(m.ref.currentRange.low - s.value.low) > 1e-9 || Math.abs(m.ref.currentRange.high - s.value.high) > 1e-9);
                const delta = !isRange && s && m.ref.current != null ? s.value.base - m.ref.current : null;
                const changed = isRange ? !!rangeChanged : delta != null && Math.abs(delta) > 1e-9;
                return (
                  <tr key={m.ref.key} className={m.tie ? 'tie-row' : !s ? 'blocked' : ''}>
                    <td>{label(m.ref)}</td>
                    <td className="n">{m.ref.metric === 'entry_post_money' && m.ref.targetKind === 'profile' && m.ref.currentRange ? `${money(m.ref.currentRange.low, 0)}–${money(m.ref.currentRange.high, 0)}` : fmtVal(m.ref.metric, m.ref.current)}</td>
                    <td className={`n ${changed ? 'changed' : ''}`}>{s ? (isRange ? `${money(s.value.low, 0)}–${money(s.value.high, 0)}` : fmtVal(m.ref.metric, s.value.base)) : m.tie ? 'choose' : 'blocked'}</td>
                    <td className="n muted">{s && !isRange ? `${fmtVal(m.ref.metric, s.value.low)} – ${fmtVal(m.ref.metric, s.value.high)}` : ''}</td>
                    <td className="n">{isRange ? (s ? (changed ? 'range' : '=') : '') : changed ? (METRIC_UNIT[m.ref.metric] === 'rate' ? `${delta! > 0 ? '+' : ''}${(delta! * 100).toFixed(1)}pp` : `${delta! > 0 ? '+' : ''}${+delta!.toFixed(2)}`) : s ? '=' : ''}</td>
                    <td className="small">
                      {m.candidates.length > 1 ? (
                        <select id={`sel-${m.ref.key}`} value={s?.id ?? ''} onChange={(e) => choose(m.ref.key, e.target.value)}>
                          {!s && <option value="">— choose —</option>}
                          {m.candidates.map((c) => (
                            <option key={c.row.id} value={c.row.id}>row {c.row.rowNumber}: {c.row.stage}/{c.row.geography || '*'}/{c.row.vintage ?? '—'} · {c.row.source}</option>
                          ))}
                        </select>
                      ) : s ? (
                        <span data-tip={`${s.source} · as of ${s.asOf} · ${s.unit}${s.notes ? `\n${s.notes}` : ''}`}>row {s.rowNumber}: {m.how} · {s.source}</span>
                      ) : (
                        <span className="muted">{m.how}</span>
                      )}
                    </td>
                    <td><Flags issues={m.flags} /></td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {match.unmatched.length > 0 && (
        <>
          <h4>Assumptions with no benchmark match ({match.unmatched.length})</h4>
          <div className="muted small">These keep their current value and provenance.</div>
          <ul className="unmatched small">
            {match.unmatched.map((u) => <li key={u.key}>{u.targetLabel} · {label(u)} <span className="muted">(current {fmtVal(u.metric, u.current)})</span></li>)}
          </ul>
        </>
      )}
      {match.unusedRows.length > 0 && (
        <>
          <h4>Rows not used by any assumption ({match.unusedRows.length})</h4>
          <ul className="unmatched small">
            {match.unusedRows.map((r) => <li key={r.id}>row {r.rowNumber}: <span className="mono">{r.metric}</span> · {r.stage}/{r.geography || '*'}/{r.vintage ?? '—'} · {unusedReason(r, match)}</li>)}
          </ul>
        </>
      )}
    </>
  );
}

function unusedReason(r: NormalizedRow, match: ReturnType<typeof matchBenchmarks>): string {
  const asCandidate = match.matches.some((m) => m.candidates.some((c) => c.row.id === r.id));
  return asCandidate ? 'outranked by a closer match' : 'no assumption with this stage / bucket in the selected structure and strategies';
}

const label = (r: AssumptionRef) => `${METRIC_LABEL[r.metric]}${r.bucketLabel ? ` · ${r.bucketLabel}` : ''}${r.metric === 'entry_post_money' && r.targetKind === 'profile' ? ' (range)' : ''}`;

function GenerateStep(p: {
  pack: BenchmarkPack;
  structure: MarketCase;
  match: ReturnType<typeof matchBenchmarks>;
  gen: ReturnType<typeof generateBenchmarkCases>;
  mapping: CaseMapping;
  setMapping: (m: CaseMapping) => void;
  residuals: Record<string, string>;
  setResiduals: (r: Record<string, string>) => void;
  prefix: string;
  setPrefix: (s: string) => void;
  applyEntry: boolean;
  setApplyEntry: (b: boolean) => void;
  entryChanges: number;
  entryStrategyCount: number;
  createFrom: string;
  setCreateFrom: (s: string) => void;
  scenarios: { id: string; name: string }[];
  onSave: () => void;
  saved: string | null;
  previewStrategy?: import('../../../engine').Strategy;
}) {
  const usedKeys = new Set<MappingKey>();
  for (const m of p.match.matches) if (m.selected) {
    const k = mappingKeyFor(m.ref);
    if (k) usedKeys.add(k);
  }
  const keys = (Object.keys(MAPPING_LABEL) as MappingKey[]).filter((k) => usedKeys.has(k));
  const points: { value: Point; label: string }[] = [{ value: 'low', label: 'low' }, { value: 'base', label: 'base' }, { value: 'high', label: 'high' }];
  const errs = p.gen.issues.filter((i) => i.severity === 'error');
  const preview = p.previewStrategy
    ? p.gen.cases.map((c) => {
        const r = evaluateFund(resolveScenario(p.previewStrategy!, c.marketCase).model);
        return { kind: c.kind, moic: r.gross.moic, irr: r.gross.irr, net: r.net.available ? r.net.netMultiple : null };
      })
    : null;

  return (
    <>
      <div className="grid-bench">
        <div className="bench-col">
          <h4>Mapping (shown before saving)</h4>
          <div className="muted small">Which benchmark point each case uses. Base always uses base. These cases are assumption bundles{p.pack.percentileBacked ? '; this source reports percentiles' : ', not statistical percentiles'}.</div>
          <table className="dense">
            <thead><tr><th>Assumption</th><th>Downside</th><th>Base</th><th>Upside</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td>{MAPPING_LABEL[k]}</td>
                  <td><Select value={p.mapping[k].downside} options={points} onChange={(v) => p.setMapping({ ...p.mapping, [k]: { ...p.mapping[k], downside: v } })} /></td>
                  <td className="muted">base</td>
                  <td><Select value={p.mapping[k].upside} options={points} onChange={(v) => p.setMapping({ ...p.mapping, [k]: { ...p.mapping[k], upside: v } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="small" onClick={() => p.setMapping(DEFAULT_CASE_MAPPING)}>Reset to default mapping</button>

          <h4>Save</h4>
          <label className="field">
            <span className="field-label">Case name prefix</span>
            <input id="case-prefix" className="text" value={p.prefix} onChange={(e) => p.setPrefix(e.target.value)} />
          </label>
          <Toggle label={`Apply entry benchmarks to ${p.entryStrategyCount} strategy(ies) (${p.entryChanges} values)`} checked={p.applyEntry} onChange={p.setApplyEntry} tip="Base values for ticket / post-money / ownership, set on the strategies chosen in step 2. Ownership is derived." />
          <Select
            label="Also create scenarios for"
            value={p.createFrom}
            options={[{ value: '', label: '— none (cases only) —' }, ...p.scenarios.map((s) => ({ value: s.id, label: `${s.name}'s strategy × Downside / Base / Upside` }))]}
            onChange={p.setCreateFrom}
          />
          {errs.length > 0 && (
            <ul className="issues small">{errs.map((i, k) => <li key={k} className="issue-error">✕ {i.message}</li>)}</ul>
          )}
          <button className="primary" disabled={!p.gen.valid} onClick={p.onSave}>Save Downside / Base / Upside</button>
          {p.saved && <div className="callout small">{p.saved}</div>}
          {preview && (
            <>
              <h4>Outcome preview ({p.scenarios.find((s) => s.id === p.createFrom)?.name})</h4>
              <table className="dense">
                <thead><tr><th>Case</th><th className="n">Gross MOIC</th><th className="n">Gross IRR</th><th className="n">Net multiple</th></tr></thead>
                <tbody>
                  {preview.map((r) => <tr key={r.kind}><td>{r.kind}</td><td className="n">{mult(r.moic)}</td><td className="n">{r.irr.ok ? pct(r.irr.value) : 'N/A'}</td><td className="n">{r.net == null ? 'N/A' : mult(r.net)}</td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="bench-col wide">
          <h4>Resulting outcome distributions</h4>
          <div className="muted small">The residual bucket absorbs 1 − Σ other rates in each case. <span className="from-bench">Underlined</span> = set from a benchmark row; ◆ = residual.</div>
          {p.structure.profiles.map((prof) => {
            const apps = p.gen.cases.map((c) => c.applications.find((a) => a.profile.id === prof.id)!);
            const residual = apps[1].profile.residualBucketId;
            return (
              <div key={prof.id} className="dist">
                <div className="row">
                  <b>{prof.label}</b>
                  <span className="spacer" />
                  <Select label="Residual bucket" value={residual ?? ''} options={prof.buckets.map((b) => ({ value: b.id, label: b.label }))} onChange={(v) => p.setResiduals({ ...p.residuals, [prof.id]: v })} />
                </div>
                <table className="dense">
                  <thead>
                    <tr><th>Bucket</th>{p.gen.cases.map((c) => <th key={c.kind} className="n">{c.kind}</th>)}<th className="n" data-tip="Equity exit value, downside / base / upside">Exit value D / B / U</th><th className="n">Exit yr D / B / U</th></tr>
                  </thead>
                  <tbody>
                    {prof.buckets.map((b) => (
                      <tr key={b.id}>
                        <td>{b.label}</td>
                        {apps.map((a, i) => {
                          const d = a.distribution.find((x) => x.bucketId === b.id)!;
                          return <td key={i} className={`n ${d.probability < -1e-9 ? 'bad' : ''}`}><span className={d.fromBenchmark ? 'from-bench' : ''}>{pct(d.probability)}</span>{d.residual ? ' ◆' : ''}</td>;
                        })}
                        <td className="n">{apps.map((a) => { const x = a.profile.buckets.find((y) => y.id === b.id)!; return x.exit.mode === 'equity' ? money(x.exit.equityValue, 0) : `${x.exit.multiple.toFixed(1)}×`; }).join(' / ')}</td>
                        <td className="n">{apps.map((a) => a.profile.buckets.find((y) => y.id === b.id)!.yearsToExit).join(' / ')}</td>
                      </tr>
                    ))}
                    <tr className="sum">
                      <td>Σ</td>
                      {apps.map((a, i) => { const s = a.distribution.reduce((x, d) => x + d.probability, 0); return <td key={i} className={`n ${a.valid ? '' : 'bad'}`}>{a.valid ? pct(s) : '✕ invalid'}</td>; })}
                      <td className="n muted" colSpan={2}>{prof.rounds.length ? `round dilution ${apps.map((a) => pct(a.profile.rounds[0].size / a.profile.rounds[0].postMoney, 0)).join(' / ')}` : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
