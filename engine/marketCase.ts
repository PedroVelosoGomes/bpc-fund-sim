import { defaultResidualBucket, setRateWithResidual } from './probabilities';
import type { MarketCase, MarketCaseKind, MarketProfile } from './scenario';
import type { Issue, Provenance, ProvenanceMap } from './types';

/** Stage-level adjustments used to derive a market case from a base case. */
export interface ProfileAdjustment {
  /** Scales every bucket's equity exit value (write-offs stay at 0). */
  exitValueMultiplier?: number;
  /** Sets the write-off bucket probability; the residual bucket absorbs the difference. */
  writeOffRate?: number;
  /** Adds whole years to non-write-off exit timings (floored at the last reached round year, min 1). */
  timeToExitShift?: number;
  /** Scales dilution: cumulative dilution (capped 95%) and each round's dilution via post-money. */
  dilutionMultiplier?: number;
  /** Optional bucket-specific probabilities (applied before the write-off rate); residual bucket absorbs. */
  outcomeRates?: Record<string, number>;
}

export interface DeriveSpec {
  id: string;
  name: string;
  kind: MarketCaseKind;
  /** Keyed by profile stage (or profile id). */
  adjustments: Record<string, ProfileAdjustment>;
  /** Provenance to stamp on adjusted values. Default: demo, noting the derivation. */
  provenance?: Provenance;
  note?: string;
}

/**
 * Derive a market case (e.g. Downside / Upside) from a base case. Returns a new case; never mutates.
 * Probabilities stay coherent: rate changes are absorbed by each profile's residual bucket.
 * Issues report adjustments that could not be applied (e.g. residual bucket would go negative).
 */
export function deriveMarketCase(base: MarketCase, spec: DeriveSpec): { marketCase: MarketCase; issues: Issue[] } {
  const issues: Issue[] = [];
  const prov: ProvenanceMap = { ...(base.provenance ?? {}) };
  const stamp: Provenance = spec.provenance ?? { kind: 'demo', note: `derived from ${base.name} (${spec.kind} mapping)` };
  const profiles: MarketProfile[] = base.profiles.map((p) => {
    const adj = spec.adjustments[p.id] ?? spec.adjustments[p.stage];
    if (!adj) return p;
    const residual = defaultResidualBucket(p.buckets, p.residualBucketId);
    let buckets = p.buckets.map((b) => ({ ...b }));
    let rounds = p.rounds.map((r) => ({ ...r }));
    const mark = (path: string) => (prov[`profiles.${p.id}.${path}`] = stamp);

    const setRate = (bucketId: string, value: number) => {
      if (!residual) return;
      const next = setRateWithResidual(buckets, bucketId, value, residual);
      if (next) {
        buckets = next;
        mark(`buckets.${bucketId}.probability`);
        mark(`buckets.${residual}.probability`);
      } else {
        issues.push({ severity: 'warning', code: 'residual_negative', message: `${p.label}: cannot set ${bucketId} to ${(value * 100).toFixed(1)}% — residual bucket would go negative. Left unchanged.`, path: `profiles.${p.id}.buckets.${bucketId}` });
      }
    };
    for (const [bid, v] of Object.entries(adj.outcomeRates ?? {})) if (bid !== residual) setRate(bid, v);
    if (adj.writeOffRate !== undefined) {
      const wo = buckets.find((b) => b.kind === 'writeoff');
      if (wo) setRate(wo.id, adj.writeOffRate);
    }
    if (adj.exitValueMultiplier !== undefined && adj.exitValueMultiplier !== 1) {
      const m = adj.exitValueMultiplier;
      buckets = buckets.map((b) => {
        if (b.kind === 'writeoff') return b;
        mark(`buckets.${b.id}.exit`);
        return { ...b, exit: b.exit.mode === 'equity' ? { ...b.exit, equityValue: b.exit.equityValue * m } : { ...b.exit, multiple: b.exit.multiple * m, netDebt: b.exit.netDebt * m } };
      });
    }
    if (adj.timeToExitShift) {
      const sorted = [...rounds].sort((a, b) => a.yearFromEntry - b.yearFromEntry);
      buckets = buckets.map((b) => {
        if (b.kind === 'writeoff') return b;
        const reached = sorted.slice(0, b.roundsReached);
        const floor = Math.max(1, reached.length ? reached[reached.length - 1].yearFromEntry : 1);
        mark(`buckets.${b.id}.yearsToExit`);
        return { ...b, yearsToExit: Math.max(floor, Math.round(b.yearsToExit + (adj.timeToExitShift ?? 0))) };
      });
    }
    if (adj.dilutionMultiplier !== undefined && adj.dilutionMultiplier !== 1) {
      const m = adj.dilutionMultiplier;
      buckets = buckets.map((b) => {
        mark(`buckets.${b.id}.cumulativeDilution`);
        return { ...b, cumulativeDilution: Math.min(0.95, b.cumulativeDilution * m) };
      });
      rounds = rounds.map((r) => {
        mark(`rounds.${r.id}`);
        const d = Math.min(0.95, (r.size / r.postMoney) * m);
        return { ...r, postMoney: r.size / d };
      });
    }
    return { ...p, buckets, rounds };
  });
  return {
    marketCase: { id: spec.id, name: spec.name, kind: spec.kind, profiles, percentileBacked: false, note: spec.note ?? `Assumption bundle derived from ${base.name}; not a statistical percentile.`, provenance: prov, derivedFrom: base.id },
    issues,
  };
}
