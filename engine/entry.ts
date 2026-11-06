import type { EntryField, EntryTerms, Issue } from './types';

/** Tolerance (absolute, in ownership decimal) for flagging inconsistent imported entry terms: 1 percentage point. */
export const ENTRY_OWNERSHIP_TOLERANCE = 0.01;

/**
 * Derive the third of (ticket, postMoney, ownership) from the other two.
 * ownership = ticket / postMoney. Returns a new object; never mutates.
 * Invalid inputs (zero/negative divisors) yield NaN in the derived field so validation can flag them.
 */
export function resolveEntry(entry: EntryTerms): EntryTerms {
  const { ticket, postMoney, ownership, derived } = entry;
  switch (derived) {
    case 'ownership':
      return { ...entry, ownership: postMoney > 0 ? ticket / postMoney : NaN };
    case 'postMoney':
      return { ...entry, postMoney: ownership > 0 ? ticket / ownership : NaN };
    case 'ticket':
      return { ...entry, ticket: ownership * postMoney };
  }
}

/** Set one field as user input, keeping `derived` fixed (unless the edited field is the derived one, in which case
 * the derived role moves to `fallbackDerived`). */
export function setEntryField(
  entry: EntryTerms,
  field: EntryField,
  value: number,
  fallbackDerived: EntryField = field === 'ownership' ? 'postMoney' : 'ownership',
): EntryTerms {
  const derived = entry.derived === field ? fallbackDerived : entry.derived;
  return resolveEntry({ ...entry, [field]: value, derived });
}

/**
 * Check whether three independently supplied values agree. Used for imports, where all three may be present.
 * Flags when |ticket/postMoney − ownership| > 1 percentage point.
 */
export function checkEntryConsistency(
  ticket: number,
  postMoney: number,
  ownership: number,
  path?: string,
): Issue | null {
  if (!(postMoney > 0)) return null;
  const implied = ticket / postMoney;
  const gap = Math.abs(implied - ownership);
  if (gap > ENTRY_OWNERSHIP_TOLERANCE) {
    return {
      severity: 'warning',
      code: 'entry_inconsistent',
      message: `Ticket ${ticket} / post-money ${postMoney} implies ${(implied * 100).toFixed(2)}% ownership, but ${(
        ownership * 100
      ).toFixed(2)}% was supplied (gap ${(gap * 100).toFixed(2)}pp > 1pp).`,
      path,
    };
  }
  return null;
}
