import { useEffect, useRef, useState } from 'react';

/**
 * One global tooltip. Any element with `data-tip="..."` shows it on hover/focus.
 * Lighter and more consistent than native `title`, and works for keyboard focus.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) return setTip(null);
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.tip ?? '', x: r.left + r.width / 2, y: r.bottom + 6 });
    };
    const hide = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]');
      if (el) setTip(null);
    };
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', () => setTip(null), true);
    return () => {
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseout', hide);
      document.removeEventListener('focusout', hide);
    };
  }, []);
  if (!tip || !tip.text) return null;
  const w = 300;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, tip.x - w / 2));
  const flip = tip.y > window.innerHeight - 120;
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left, top: flip ? undefined : tip.y, bottom: flip ? window.innerHeight - tip.y + 30 : undefined, maxWidth: w }}>
      {tip.text}
    </div>
  );
}
