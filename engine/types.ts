/**
 * Public types for the fund engine.
 *
 * Contract rules (see engine/README.md):
 *  - Every type here is plain, JSON-serialisable data. No classes, no Dates, no functions.
 *  - Money is a number in millions of the fund currency (default EUR). Never rounded by the engine.
 *  - Time is an integer year index from fund start (year 0). All flows are at year end; the
 *    year index is the discounting period.
 *  - Rates/probabilities/ownership are decimals (0.25 = 25%).
 */

export type Currency = string; // ISO 4217, e.g. "EUR"

// ---------------------------------------------------------------------------
// Provenance (kept beside values, keyed by path, so the engine math stays on plain numbers)
// ---------------------------------------------------------------------------

export type Provenance =
  | { kind: 'benchmark'; source: string; asOf: string; unit: string; benchmarkId?: string; note?: string }
  | { kind: 'demo'; note?: string }
  | { kind: 'user'; at?: string; previous?: Provenance };

/** Map from a dotted value path (e.g. "cohorts.c1.entry.ticket") to its provenance. */
export type ProvenanceMap = Record<string, Provenance>;

// ---------------------------------------------------------------------------
// Fund terms
// ---------------------------------------------------------------------------

export interface FeeTerms {
  enabled: boolean;
  /** Annual rate on commitments during the investment period, e.g. 0.02. */
  investmentPeriodRate: number;
  /** Annual rate after the investment period, e.g. 0.015. */
  postPeriodRate: number;
  /** Basis after the investment period. Default 'net_invested'. */
  postPeriodBasis: 'net_invested' | 'commitments';
}

export interface CarryTerms {
  enabled: boolean;
  /** Only 'european' (whole-fund) in v1. */
  convention: 'european';
  /** GP carried interest share, e.g. 0.2. */
  carryRate: number;
  /** Compounding annual preferred return, e.g. 0.08. */
  hurdleRate: number;
  /** Share of distributions going to GP during catch-up. 1 = 100% (full) catch-up. Must exceed carryRate. */
  catchUpRate: number;
}

export interface ReserveTerms {
  mode: 'amount' | 'percent';
  /** Amount (millions) when mode = 'amount'; decimal share of investable capital when mode = 'percent'. */
  value: number;
}

export interface Sleeve {
  id: string;
  label: string;
  /** Indicative allocation in millions. */
  amount: number;
  /** 'direct': funds cohorts' investments. 'separate': a separate use of capital, not modelled as investments. */
  use: 'direct' | 'separate';
}

export interface FundTerms {
  id: string;
  name: string;
  currency: Currency;
  committedCapital: number;
  investmentPeriodYears: number;
  fundLifeYears: number;
  fees: FeeTerms;
  carry: CarryTerms;
  reserve: ReserveTerms;
  sleeves: Sleeve[];
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

export type DeploymentProfile =
  | { mode: 'single'; entryYear: number }
  /** weights[i] = share of the cohort's companies entering in year i (from fund start). Must sum to 1. */
  | { mode: 'spread'; weights: number[] };

export type EntryField = 'ticket' | 'postMoney' | 'ownership';

export interface EntryTerms {
  /** Initial ticket per company (millions). */
  ticket: number;
  /** Post-money valuation at entry (millions). */
  postMoney: number;
  /** Entry ownership (decimal). */
  ownership: number;
  /** Which of the three is derived from the other two. ownership = ticket / postMoney. */
  derived: EntryField;
}

export interface RoundSpec {
  id: string;
  label: string;
  /** Years after the company's entry. Integer >= 1. */
  yearFromEntry: number;
  /** Round size (millions, total raised by the company). */
  size: number;
  /** Round post-money valuation (millions). Round dilution = size / postMoney. */
  postMoney: number;
}

export type FollowOnPolicy =
  | { kind: 'none' }
  /** Invest ownership × round size in each modelled round the bucket reaches. Ownership held constant through them. */
  | { kind: 'pro_rata' }
  | {
      kind: 'fixed';
      /** Fixed follow-on ticket per receiving company (millions). */
      ticket: number;
      /** Share of the cohort's companies receiving it (decimal). */
      fractionOfCohort: number;
      /** Bucket ids eligible to receive it. Default: strong exit + outlier. */
      bucketIds: string[];
      /** 0-based index of the round (in the cohort round schedule) in which the ticket is invested. Default 0. */
      roundIndex: number;
    };

export type BucketKind = 'writeoff' | 'modest' | 'strong' | 'outlier' | 'other';

export type ExitValueSpec =
  | { mode: 'equity'; equityValue: number }
  /**
   * Enterprise value = revenue × multiple. Equity = EV − netDebt (netDebt negative = net cash).
   * When the multiple is an equity multiple, set netDebt = 0.
   */
  | { mode: 'revenue'; revenue: number; multiple: number; netDebt: number };

export interface OutcomeBucket {
  id: string;
  label: string;
  kind: BucketKind;
  /** Probability (decimal). Buckets in a cohort must sum to 1. */
  probability: number;
  /** Years from entry to exit (integer >= 0). For write-offs this is the year the loss is recognised. */
  yearsToExit: number;
  exit: ExitValueSpec;
  /** Number of modelled follow-on rounds the company reaches before exit (first N rounds of the schedule). */
  roundsReached: number;
  /** Quick mode: cumulative dilution entry→exit (decimal). Explicit mode: additional dilution not in modelled rounds (ESOP etc.). */
  cumulativeDilution: number;
}

export interface CohortModel {
  id: string;
  label: string;
  stage: string;
  geography?: string;
  sleeveId?: string;
  /** Strategy label such as "Concentrated", "Exploration" (free text, descriptive). */
  strategyTag?: string;
  companyCount: number;
  deployment: DeploymentProfile;
  entry: EntryTerms;
  followOn: FollowOnPolicy;
  dilutionMode: 'quick' | 'explicit';
  rounds: RoundSpec[];
  buckets: OutcomeBucket[];
  /** Bucket that absorbs residual probability when another rate moves (default: modest exit). */
  residualBucketId?: string;
}

/** The fully-resolved input to `evaluateFund`. */
export interface FundModel {
  fund: FundTerms;
  cohorts: CohortModel[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type CashFlowKind = 'initial' | 'follow_on' | 'proceeds' | 'fee';

/** One line of the expected cash-flow ledger. Investments/fees are negative, proceeds positive. */
export interface CashFlowLine {
  year: number;
  kind: CashFlowKind;
  amount: number;
  cohortId?: string;
  bucketId?: string;
  /** Entry year of the sub-cohort that produced the line. */
  vintage?: number;
  /** For fixed follow-on policies: whether the line belongs to the receiving sub-group. */
  recipient?: boolean;
  /** Round id for follow-on lines. */
  roundId?: string;
  /** Expected number of companies the line represents. */
  companies?: number;
}

export type IrrResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'no_sign_change' | 'multiple_roots' | 'no_convergence' | 'empty' };

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** Dotted path of the offending input, e.g. "cohorts.c1.buckets". */
  path?: string;
}

export interface OwnershipStep {
  label: string;
  year: number; // years from entry
  ownershipBefore: number;
  ownershipAfter: number;
  invested: number; // per company
  dilution: number;
}

export interface BucketResult {
  bucketId: string;
  label: string;
  kind: BucketKind;
  probability: number;
  expectedCompanies: number;
  yearsToExit: number;
  equityValue: number;
  /** For revenue-mode exits, the enterprise value before net debt. */
  enterpriseValue?: number;
  roundsReached: number;
  /** Exit ownership per company (non-recipient path). */
  exitOwnership: number;
  /** Exit ownership for fixed follow-on recipients (if any). */
  exitOwnershipRecipient?: number;
  /** Share of this bucket's companies receiving the fixed follow-on. */
  recipientShare: number;
  ownershipPath: OwnershipStep[];
  ownershipPathRecipient?: OwnershipStep[];
  initialInvested: number;
  followOnInvested: number;
  /** Follow-on per company (non-recipient / recipient). */
  followOnPerCompany: number;
  followOnPerCompanyRecipient?: number;
  proceeds: number;
  /** Proceeds / cohort proceeds. */
  shareOfCohortProceeds: number;
  /** Proceeds / fund proceeds. */
  shareOfFundProceeds: number;
  exitYears: number[];
}

export interface CohortResult {
  cohortId: string;
  label: string;
  sleeveId?: string;
  companyCount: number;
  entryOwnership: number;
  initialInvested: number;
  followOnInvested: number;
  invested: number;
  proceeds: number;
  grossMoic: number | null;
  grossIrr: IrrResult;
  /** Largest initial + planned follow-on for a single company (worst-case bucket path). */
  maxCompanyExposure: number;
  buckets: BucketResult[];
  /** Follow-on capital by year for the cohort (negative-free, positive numbers). */
  followOnByYear: number[];
}

export interface AnnualRow {
  year: number;
  initialInvestment: number;
  followOnInvestment: number;
  fees: number;
  /** Capital called from LPs this year (investments + fees). */
  paidIn: number;
  grossProceeds: number;
  /** Gross flow: proceeds − investments (excludes fees). */
  grossNetFlow: number;
  lpDistributions: number;
  gpCarry: number;
  /** LP perspective: distributions − paid-in. */
  lpNetFlow: number;
  cumulativeLpNetFlow: number;
  cumulativeGrossNetFlow: number;
  /** Net invested capital at year end (cost basis of unrealised companies). */
  netInvestedCapital: number;
  cumulativeFollowOn: number;
  reserveRemaining: number;
  reserveOverAllocated: boolean;
}

export interface CapitalSummary {
  committed: number;
  totalFees: number;
  /** Committed − lifetime fees. */
  investable: number;
  separateSleeves: number;
  /** Investable − separate-use sleeves. */
  directInvestable: number;
  reserve: number;
  /** Direct investable − reserve. */
  initialBudget: number;
  initialInvested: number;
  followOnInvested: number;
  invested: number;
  /** LP capital called: invested + fees. */
  paidIn: number;
  reserveUsed: number;
  reserveUnused: number;
  reserveOverAllocation: number;
  initialOverAllocation: number;
  /** Direct investable − invested (negative = over-allocated). */
  unusedCapacity: number;
  /** Sum of sleeves − investable (positive when fees make the sleeves exceed investable capital). */
  sleeveGap: number;
  sleeveUsage: { sleeveId: string; label: string; amount: number; use: Sleeve['use']; invested: number; remaining: number }[];
}

export interface WaterfallTotals {
  lpDistributions: number;
  gpCarry: number;
  returnOfCapital: number;
  preferredReturn: number;
  catchUp: number;
  splitToLp: number;
  splitToGp: number;
  clawback: number;
}

export interface NetResult {
  available: boolean;
  reason?: string;
  convention: string;
  netMultiple: number | null;
  netIrr: IrrResult;
  waterfall?: WaterfallTotals;
}

export interface FundResult {
  label: 'expected cash-flow case';
  currency: Currency;
  capital: CapitalSummary;
  gross: { proceeds: number; moic: number | null; irr: IrrResult };
  net: NetResult;
  /** Annual rows from year 0 to the last year with any flow (at least fund life). */
  annual: AnnualRow[];
  ledger: CashFlowLine[];
  cohorts: CohortResult[];
  outlierProceeds: number;
  outlierShare: number | null;
  timeToFirstDistribution: number | null;
  issues: Issue[];
}
