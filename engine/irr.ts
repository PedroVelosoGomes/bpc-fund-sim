import type { IrrResult } from './types';

/** Net present value of annual flows (flows[t] at year-end t, t=0 undiscounted). */
export function npv(rate: number, flows: number[]): number {
  let v = 0;
  for (let t = 0; t < flows.length; t++) v += flows[t] / Math.pow(1 + rate, t);
  return v;
}

function dnpv(rate: number, flows: number[]): number {
  let v = 0;
  for (let t = 1; t < flows.length; t++) v -= (t * flows[t]) / Math.pow(1 + rate, t + 1);
  return v;
}

const EPS = 1e-12;
const LOW = -0.9999;
const HIGH = 1000; // 100,000% — beyond this we treat as no root

/** Count sign changes in a sequence, ignoring (near-)zero entries. */
export function signChanges(flows: number[]): number {
  let last = 0;
  let n = 0;
  for (const f of flows) {
    if (Math.abs(f) < EPS) continue;
    const s = Math.sign(f);
    if (last !== 0 && s !== last) n++;
    last = s;
  }
  return n;
}

/**
 * Annual IRR. Convention: annual periods, all flows at year end, flows[t] discounted by (1+r)^t.
 * Newton's method from 10%, falling back to bisection. Returns N/A when:
 *  - no sign change in the flows ('no_sign_change'),
 *  - more than one root is found on a scan of the rate range ('multiple_roots'),
 *  - no convergence ('no_convergence').
 */
export function irr(flows: number[]): IrrResult {
  const f = trimTrailingZeros(flows);
  if (f.length < 2) return { ok: false, reason: 'empty' };
  const changes = signChanges(f);
  if (changes === 0) return { ok: false, reason: 'no_sign_change' };

  if (changes > 1) {
    // Descartes: possibly several roots. Scan for NPV sign changes over the rate range.
    const roots = scanRoots(f);
    if (roots > 1) return { ok: false, reason: 'multiple_roots' };
    if (roots === 0) return { ok: false, reason: 'no_convergence' };
  }

  const newton = newtonSolve(f);
  if (newton !== null) return { ok: true, value: newton };
  const bis = bisectionSolve(f);
  if (bis !== null) return { ok: true, value: bis };
  return { ok: false, reason: 'no_convergence' };
}

function trimTrailingZeros(flows: number[]): number[] {
  let end = flows.length;
  while (end > 0 && Math.abs(flows[end - 1]) < EPS) end--;
  return flows.slice(0, end);
}

function scanRoots(flows: number[]): number {
  // Log-spaced grid on (1+r) from 1e-4 to 1001.
  const N = 4000;
  let roots = 0;
  let prev = npv(LOW, flows);
  for (let i = 1; i <= N; i++) {
    const g = Math.exp(Math.log(1 + LOW) + ((Math.log(1 + HIGH) - Math.log(1 + LOW)) * i) / N);
    const r = g - 1;
    const cur = npv(r, flows);
    if (Number.isFinite(prev) && Number.isFinite(cur) && Math.sign(cur) !== Math.sign(prev) && cur !== 0) roots++;
    prev = cur;
  }
  return roots;
}

function newtonSolve(flows: number[]): number | null {
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(r, flows);
    const d = dnpv(r, flows);
    if (!Number.isFinite(v) || !Number.isFinite(d) || Math.abs(d) < EPS) return null;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= LOW || next > HIGH) return null;
    if (Math.abs(next - r) < 1e-10) return Math.abs(npv(next, flows)) < 1e-6 * scale(flows) ? next : null;
    r = next;
  }
  return null;
}

function bisectionSolve(flows: number[]): number | null {
  let lo = LOW;
  let hi = 1;
  let flo = npv(lo, flows);
  let fhi = npv(hi, flows);
  while (Math.sign(flo) === Math.sign(fhi) && hi < HIGH) {
    hi = hi * 2 + 1;
    fhi = npv(hi, flows);
  }
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, flows);
    if (Math.abs(fm) < 1e-10 * scale(flows) || hi - lo < 1e-12) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function scale(flows: number[]): number {
  return Math.max(1, ...flows.map(Math.abs));
}

export function irrLabel(r: IrrResult): string {
  if (r.ok) return `${(r.value * 100).toFixed(1)}%`;
  switch (r.reason) {
    case 'no_sign_change':
      return 'N/A — no sign change';
    case 'multiple_roots':
      return 'N/A — no unique IRR';
    case 'no_convergence':
      return 'N/A — did not converge';
    case 'empty':
      return 'N/A — no flows';
  }
}
