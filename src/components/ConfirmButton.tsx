import { useEffect, useState, type ReactNode } from 'react';

/**
 * Two-step destructive button: the first click arms it ("Delete?"), the second confirms.
 * Disarms after 4s or on blur. Replaces window.confirm, which some hosts (sandboxed iframes) block.
 */
export function ConfirmButton(props: { onConfirm: () => void; children: ReactNode; confirmLabel: string; className?: string; tip?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${props.className ?? ''} ${armed ? 'armed' : ''}`}
      data-tip={armed ? 'Click again to confirm' : props.tip}
      onBlur={() => setArmed(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? props.confirmLabel : props.children}
    </button>
  );
}
