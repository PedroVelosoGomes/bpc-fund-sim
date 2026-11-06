import { useEffect, useMemo, useState } from 'react';
import { exitEquityValue, probabilitySum, renormaliseInto, PROBABILITY_TOLERANCE, type BucketKind, type CohortModel, type OutcomeBucket } from '../../../engine';
import type { ScenarioBundle } from '../../state/results';
import { useStore } from '../../state/store';
import { NumField, Select, TextField, Val } from '../fields';
import { money, pct } from '../../lib/format';

const FIELDS = ['probability', 'yearsToExit', 'exit', 'roundsReached', 'cumulativeDilution'] as const;

/**
 * Outcome buckets are edited as a draft. Saving is blocked unless probabilities sum to 100%;
 * the editor offers "renormalise into bucket X". Saved edits become scenario-level overrides.
 */
export function BucketEditor({ b, cohort }: { b: ScenarioBundle; cohort: CohortModel }) {
  const [draft, setDraft] = useState<OutcomeBucket[]>(cohort.buckets);
  useEffect(() => setDraft(cohort.buckets), [cohort.buckets]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(cohort.buckets), [draft, cohort.buckets]);
  const sum = probabilitySum(draft);
  const valid = Math.abs(sum - 1) <= PROBABILITY_TOLERANCE;
  const p = (bid: string, f: string) => b.prov(`cohorts.${cohort.id}.buckets.${bid}.${f}`);
  const upd = (i: number, patch: Partial<OutcomeBucket>) => setDraft(draft.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () => {
    const paths: string[] = [];
    for (const nb of draft) {
      const ob = cohort.buckets.find((x) => x.id === nb.id);
      for (const f of FIELDS) if (!ob || JSON.stringify(ob[f]) !== JSON.stringify(nb[f])) paths.push(`cohorts.${cohort.id}.buckets.${nb.id}.${f}`);
    }
    useStore.getState().setCohortOverride(b.scenario.id, cohort.id, { buckets: draft }, paths);
  };
  const dilLabel = cohort.dilutionMode === 'quick' ? 'Cum. dil.' : 'Extra dil.';
  const dilTip = cohort.dilutionMode === 'quick' ? 'Cumulative dilution entry → exit. Exit ownership = entry × (1 − cumulative dilution).' : 'Additional dilution not in modelled rounds (ESOP, unmodelled rounds), applied before exit.';

  return (
    <div className="sub">
      <div className="field-label">Outcome buckets</div>
      <div className="table-scroll">
        <table className="dense buckets">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Kind</th>
              <th className="n">Prob.</th>
              <th className="n" data-tip="Years from entry to exit">Exit yr</th>
              <th>Exit value</th>
              <th className="n" data-tip="Equity value at exit (EV − net debt for revenue mode)">Equity</th>
              <th className="n" data-tip="Modelled follow-on rounds reached before exit. Follow-on capital is only deployed into these.">Rounds</th>
              <th className="n" data-tip={dilTip}>{dilLabel}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.map((bk, i) => {
              const eq = exitEquityValue(bk.exit);
              return (
                <tr key={bk.id}>
                  <td><TextField value={bk.label} width={78} onCommit={(v) => upd(i, { label: v })} /></td>
                  <td>
                    <Select value={bk.kind} options={(['writeoff', 'modest', 'strong', 'outlier', 'other'] as BucketKind[]).map((k) => ({ value: k, label: k }))} onChange={(k) => upd(i, { kind: k })} />
                  </td>
                  <td className="n"><NumField unit="%" width={40} min={0} max={1} value={bk.probability} prov={p(bk.id, 'probability')} invalid={!valid} onCommit={(v) => upd(i, { probability: v })} /></td>
                  <td className="n"><NumField width={28} integer min={0} value={bk.yearsToExit} prov={p(bk.id, 'yearsToExit')} onCommit={(v) => upd(i, { yearsToExit: v })} /></td>
                  <td>
                    <div className="row nowrap">
                      <Select value={bk.exit.mode} options={[{ value: 'equity', label: 'Equity' }, { value: 'revenue', label: 'Rev × mult' }]} onChange={(m) => upd(i, { exit: m === 'equity' ? { mode: 'equity', equityValue: eq.equity } : { mode: 'revenue', revenue: eq.equity / 5, multiple: 5, netDebt: 0 } })} />
                      {bk.exit.mode === 'equity' ? (
                        <NumField width={52} unit="m" min={0} value={bk.exit.equityValue} prov={p(bk.id, 'exit')} onCommit={(v) => upd(i, { exit: { mode: 'equity', equityValue: v } })} />
                      ) : (
                        <>
                          <NumField width={40} unit="m" min={0} value={bk.exit.revenue} prov={p(bk.id, 'exit')} tip="Revenue at exit" onCommit={(v) => upd(i, { exit: { ...(bk.exit as Extract<OutcomeBucket['exit'], { mode: 'revenue' }>), revenue: v } })} />
                          <NumField width={32} unit="x" min={0} value={bk.exit.multiple} prov={p(bk.id, 'exit')} tip="EV / revenue multiple" onCommit={(v) => upd(i, { exit: { ...(bk.exit as Extract<OutcomeBucket['exit'], { mode: 'revenue' }>), multiple: v } })} />
                          <NumField width={36} unit="m" value={bk.exit.netDebt} prov={p(bk.id, 'exit')} tip="Net debt subtracted from EV (negative = net cash, added)" onCommit={(v) => upd(i, { exit: { ...(bk.exit as Extract<OutcomeBucket['exit'], { mode: 'revenue' }>), netDebt: v } })} />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="n">
                    <Val prov={p(bk.id, 'exit')} tip={eq.enterprise !== undefined ? `EV ${money(eq.enterprise)}m − net debt ${money((bk.exit as { netDebt: number }).netDebt)}m = equity ${money(eq.equity)}m` : undefined}>
                      {money(eq.equity, 0)}
                    </Val>
                  </td>
                  <td className="n"><NumField width={24} integer min={0} value={bk.roundsReached} prov={p(bk.id, 'roundsReached')} onCommit={(v) => upd(i, { roundsReached: v })} /></td>
                  <td className="n"><NumField width={36} unit="%" min={0} max={0.99} value={bk.cumulativeDilution} prov={p(bk.id, 'cumulativeDilution')} onCommit={(v) => upd(i, { cumulativeDilution: v })} /></td>
                  <td>{draft.length > 1 && <button className="icon" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row wrap">
        <span className={`small ${valid ? 'muted' : 'bad'}`}>Σ probability {pct(sum, 2)}</span>
        <button className="small" onClick={() => setDraft([...draft, { id: `b-${Date.now().toString(36)}`, label: 'New bucket', kind: 'other', probability: 0, yearsToExit: 5, exit: { mode: 'equity', equityValue: 50 }, roundsReached: 0, cumulativeDilution: 0 }])}>+ bucket</button>
        <span className="spacer" />
        {!valid && (
          <span className="small">
            Renormalise into:{' '}
            {draft.map((bk) => {
              const r = renormaliseInto(draft, bk.id);
              return (
                <button key={bk.id} className="small" disabled={!r} onClick={() => r && setDraft(r)} data-tip={r ? `Put the ${pct(1 - sum, 2)} residual into ${bk.label}` : 'Would make this bucket negative'}>
                  {bk.label}
                </button>
              );
            })}
          </span>
        )}
        {dirty && <button className="small" onClick={() => setDraft(cohort.buckets)}>Cancel</button>}
        <button className="small primary" disabled={!dirty || !valid} onClick={save} data-tip={!valid ? 'Probabilities must sum to 100% before saving' : 'Save as a scenario override'}>
          Save buckets
        </button>
      </div>
    </div>
  );
}
