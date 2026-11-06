import { z } from 'zod';
import { schemas, type MarketCase, type Scenario, type Strategy } from '../../engine';

/** Bump when the persisted shape changes; add a migration in persistence.ts. */
export const WORKSPACE_SCHEMA_VERSION = 1;

export interface Workspace {
  schemaVersion: number;
  strategies: Record<string, Strategy>;
  marketCases: Record<string, MarketCase>;
  scenarios: Record<string, Scenario>;
  /** Display order of scenarios in the list. */
  scenarioOrder: string[];
  /** Data origin, shown in the header. */
  dataLabel: 'illustrative demo data' | 'benchmark pack' | 'empty';
  updatedAt: string;
}

export interface UiPrefs {
  focusedId?: string;
  compareIds: string[];
  theme: 'system' | 'light' | 'dark';
}

export interface PersistedState {
  schemaVersion: number;
  workspace: Workspace;
  ui: UiPrefs;
}

export const workspaceSchema = z.object({
  schemaVersion: z.number().int(),
  strategies: z.record(schemas.strategySchema),
  marketCases: z.record(schemas.marketCaseSchema),
  scenarios: z.record(schemas.scenarioSchema),
  scenarioOrder: z.array(z.string()),
  dataLabel: z.enum(['illustrative demo data', 'benchmark pack', 'empty']),
  updatedAt: z.string(),
});

export const persistedSchema = z.object({
  schemaVersion: z.number().int(),
  workspace: workspaceSchema,
  ui: z.object({ focusedId: z.string().optional(), compareIds: z.array(z.string()), theme: z.enum(['system', 'light', 'dark']) }),
});

export const emptyWorkspace = (): Workspace => ({
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  strategies: {},
  marketCases: {},
  scenarios: {},
  scenarioOrder: [],
  dataLabel: 'empty',
  updatedAt: new Date().toISOString(),
});
