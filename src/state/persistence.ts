import { get, set, del } from 'idb-keyval';
import { persistedSchema, WORKSPACE_SCHEMA_VERSION, type PersistedState } from './workspace';

export const STORAGE_KEY = 'bpc-fund-sim/workspace';
const BACKUP_KEY = 'bpc-fund-sim/workspace-unreadable-backup';

type Migration = (raw: any) => any;

/**
 * Migrations keyed by the version they upgrade FROM. Each returns data at version + 1.
 * Example for a future v2: 1: (s) => ({ ...s, schemaVersion: 2, workspace: { ...s.workspace, benchmarks: {} } })
 */
export const MIGRATIONS: Record<number, Migration> = {
  // v0 (pre-release, unversioned) → v1: add the dataLabel and ui block.
  0: (s) => ({
    schemaVersion: 1,
    workspace: { dataLabel: 'illustrative demo data', scenarioOrder: Object.keys(s.workspace?.scenarios ?? {}), ...s.workspace, schemaVersion: 1 },
    ui: s.ui ?? { compareIds: [], theme: 'system' },
  }),
  // v1 → v2: benchmark packs added to the workspace.
  1: (s) => ({ ...s, schemaVersion: 2, workspace: { ...s.workspace, schemaVersion: 2, benchmarks: s.workspace?.benchmarks ?? {} } }),
};

export function migrate(raw: any): { state: PersistedState | null; error?: string; migratedFrom?: number } {
  if (!raw || typeof raw !== 'object') return { state: null };
  let v: number = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  const from = v;
  let cur = raw;
  if (v > WORKSPACE_SCHEMA_VERSION) return { state: null, error: `Saved workspace is from a newer version (${v}).` };
  while (v < WORKSPACE_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) return { state: null, error: `No migration from schema version ${v}.` };
    cur = m(cur);
    v = cur.schemaVersion;
  }
  const parsed = persistedSchema.safeParse(cur);
  if (!parsed.success) return { state: null, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { state: parsed.data as PersistedState, migratedFrom: from !== v ? from : undefined };
}

export async function loadState(): Promise<{ state: PersistedState | null; error?: string }> {
  try {
    const raw = await get(STORAGE_KEY);
    if (raw == null) return { state: null };
    const res = migrate(raw);
    if (!res.state && res.error) await set(BACKUP_KEY, raw); // keep the unreadable copy, never silently drop it
    return res;
  } catch (e) {
    return { state: null, error: String(e) };
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  await set(STORAGE_KEY, state);
}

export async function clearState(): Promise<void> {
  await del(STORAGE_KEY);
}
