import type { OutcomeBucket } from './types';

export const PROBABILITY_TOLERANCE = 1e-6;

export function probabilitySum(buckets: Pick<OutcomeBucket, 'probability'>[]): number {
  return buckets.reduce((a, b) => a + b.probability, 0);
}

export function probabilitiesValid(buckets: Pick<OutcomeBucket, 'probability'>[]): boolean {
  return Math.abs(probabilitySum(buckets) - 1) <= PROBABILITY_TOLERANCE && buckets.every((b) => b.probability >= 0);
}

/**
 * "Renormalise into bucket X": put the whole residual (1 − sum) into one bucket.
 * Returns null if that would make the bucket negative.
 */
export function renormaliseInto<T extends OutcomeBucket>(buckets: T[], bucketId: string): T[] | null {
  const residual = 1 - probabilitySum(buckets);
  const out = buckets.map((b) => (b.id === bucketId ? { ...b, probability: b.probability + residual } : b));
  const target = out.find((b) => b.id === bucketId);
  if (!target || target.probability < -PROBABILITY_TOLERANCE) return null;
  return out.map((b) => (b.id === bucketId ? { ...b, probability: Math.max(0, b.probability) } : b));
}

/**
 * Move one bucket's probability to `value`, with the residual absorbed by `residualBucketId`.
 * Returns null if the residual bucket would go negative.
 */
export function setRateWithResidual<T extends OutcomeBucket>(
  buckets: T[],
  bucketId: string,
  value: number,
  residualBucketId: string,
): T[] | null {
  if (bucketId === residualBucketId) return null;
  const moved = buckets.map((b) => (b.id === bucketId ? { ...b, probability: value } : b));
  return renormaliseInto(moved, residualBucketId);
}

/** Default residual bucket: explicit id, else first 'modest' bucket, else the first bucket. */
export function defaultResidualBucket(buckets: OutcomeBucket[], explicit?: string): string | undefined {
  if (explicit && buckets.some((b) => b.id === explicit)) return explicit;
  return buckets.find((b) => b.kind === 'modest')?.id ?? buckets[0]?.id;
}
