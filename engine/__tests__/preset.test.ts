import { describe, expect, it } from 'vitest';
import { evaluateFund } from '../fund';
import { resolveScenario } from '../scenario';
import * as P from '../preset';
import { schemas } from '../index';

describe('Bright Pixel demo preset', () => {
  const { model, issues } = resolveScenario(P.brightPixelStrategy, P.brightPixelBaseCase);
  const r = evaluateFund(model);

  it('resolves without errors', () => {
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('sleeves sum to the €250M commitment', () => {
    expect(P.brightPixelFund.sleeves.reduce((a, s) => a + s.amount, 0)).toBe(250);
    expect(r.capital.sleeveGap).toBeGreaterThan(0); // fees enabled → gap shown
  });
  it('has 40–50 companies and €100–125M initial deployment', () => {
    const n = P.brightPixelStrategy.cohorts.reduce((a, c) => a + c.companyCount, 0);
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(50);
    expect(r.capital.initialInvested).toBeGreaterThanOrEqual(100);
    expect(r.capital.initialInvested).toBeLessThanOrEqual(125);
  });
  it('labels every market value as demo data', () => {
    const prov = P.brightPixelScenario.provenance;
    expect(Object.values(prov).every((p) => p.kind === 'demo')).toBe(true);
    expect(prov['profiles.mp-seed-eu.buckets.ou.exit']).toBeDefined();
  });
  it('validates against the Zod schemas', () => {
    expect(schemas.strategySchema.safeParse(P.brightPixelStrategy).success).toBe(true);
    expect(schemas.marketCaseSchema.safeParse(P.brightPixelBaseCase).success).toBe(true);
    expect(schemas.scenarioSchema.safeParse(P.brightPixelScenario).success).toBe(true);
    expect(schemas.fundModelSchema.safeParse(model).success).toBe(true);
  });
  it('produces gross and net metrics', () => {
    expect(r.gross.moic).toBeGreaterThan(1);
    expect(r.net.available).toBe(true);
    expect(r.gross.irr.ok).toBe(true);
  });
});
