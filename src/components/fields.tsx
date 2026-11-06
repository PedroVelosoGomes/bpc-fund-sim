import { useEffect, useState, type ReactNode } from 'react';
import type { Provenance } from '../../engine';
import { provClass, provenanceText } from '../lib/format';

type Unit = 'm' | '%' | 'x' | 'yrs' | '' | '#';

const toDisplay = (v: number, unit: Unit) => (unit === '%' ? +(v * 100).toPrecision(10) : v);
const fromDisplay = (v: number, unit: Unit) => (unit === '%' ? v / 100 : v);

/**
 * Numeric input that commits on blur / Enter. Shows provenance styling + tooltip.
 * Percent fields take and return decimals (0.25) but display 25.
 */
export function NumField(props: {
  label?: ReactNode;
  value: number;
  onCommit: (v: number) => void;
  unit?: Unit;
  prov?: Provenance;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  disabled?: boolean;
  width?: number;
  tip?: string;
  invalid?: boolean;
}) {
  const unit = props.unit ?? '';
  const [text, setText] = useState(fmt(toDisplay(props.value, unit)));
  useEffect(() => setText(fmt(toDisplay(props.value, unit))), [props.value, unit]);
  const commit = () => {
    const n = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(n)) return setText(fmt(toDisplay(props.value, unit)));
    let v = fromDisplay(n, unit);
    if (props.integer) v = Math.round(v);
    if (props.min !== undefined) v = Math.max(props.min, v);
    if (props.max !== undefined) v = Math.min(props.max, v);
    if (v !== props.value) props.onCommit(v);
    else setText(fmt(toDisplay(props.value, unit)));
  };
  const input = (
    <span className={`numfield ${provClass(props.prov)} ${props.invalid ? 'invalid' : ''}`} data-tip={props.tip ? `${props.tip}\n${provenanceText(props.prov)}` : provenanceText(props.prov)}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={props.disabled}
        style={props.width ? { width: props.width } : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(fmt(toDisplay(props.value, unit)));
        }}
      />
      {unit && unit !== '#' && <span className="unit">{unit}</span>}
    </span>
  );
  if (!props.label) return input;
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {input}
    </label>
  );
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(+v.toFixed(6));
}

export function Select<T extends string>(props: { label?: ReactNode; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; tip?: string; disabled?: boolean }) {
  const sel = (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)} data-tip={props.tip} disabled={props.disabled}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!props.label) return sel;
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {sel}
    </label>
  );
}

export function Toggle(props: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; tip?: string }) {
  return (
    <label className="toggle" data-tip={props.tip}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function TextField(props: { value: string; onCommit: (v: string) => void; label?: ReactNode; width?: number }) {
  const [t, setT] = useState(props.value);
  useEffect(() => setT(props.value), [props.value]);
  const input = (
    <input
      type="text"
      className="text"
      value={t}
      style={props.width ? { width: props.width } : undefined}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => t.trim() && t !== props.value && props.onCommit(t.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
  if (!props.label) return input;
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {input}
    </label>
  );
}

/** Read-only number with provenance tooltip (for derived/displayed inputs). */
export function Val(props: { children: ReactNode; prov?: Provenance; tip?: string; className?: string }) {
  return (
    <span className={`val ${provClass(props.prov)} ${props.className ?? ''}`} data-tip={props.tip ?? provenanceText(props.prov)}>
      {props.children}
    </span>
  );
}

export function Section(props: { title: ReactNode; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <section className="section">
      <header onClick={() => setOpen(!open)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <h3>{props.title}</h3>
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{props.right}</span>
      </header>
      {open && <div className="section-body">{props.children}</div>}
    </section>
  );
}
