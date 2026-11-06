/**
 * @module engine — Bright Pixel fund simulator calculation engine. Public API.
 * Pure TypeScript: no React, no DOM, no I/O. All inputs/outputs are JSON-serialisable. Deterministic.
 */
export * from './types';
export { resolveEntry, setEntryField, checkEntryConsistency, ENTRY_OWNERSHIP_TOLERANCE } from './entry';
export { irr, npv, signChanges, irrLabel } from './irr';
export { feeSchedule } from './fees';
export { europeanWaterfall, EUROPEAN_CONVENTION_LABEL, type WaterfallResult } from './waterfall';
export { probabilitySum, probabilitiesValid, renormaliseInto, setRateWithResidual, defaultResidualBucket, PROBABILITY_TOLERANCE } from './probabilities';
export { evaluateCohort, ownershipPath, exitEquityValue, roundDilution, deploymentWeights, fixedCoverage, flowsByYear, sortedRounds, type CohortEvaluation, type OwnershipPathResult } from './cohort';
export { evaluateFund, reserveAmount, validateFundTerms } from './fund';
export { perturb, sensitivityGrid, defaultAxis, metricValue, SENSITIVITY_VARIABLES, type SensitivityVariable, type SensitivityMetric, type SensitivityGrid } from './sensitivity';
export { resolveScenario, findProfile, type Strategy, type MarketCase, type MarketCaseKind, type MarketProfile, type CohortStrategy, type Scenario, type CohortMarketOverride } from './scenario';
export * as presets from './preset';
export * as schemas from './schema';
export const ENGINE_VERSION = '0.1.0';
