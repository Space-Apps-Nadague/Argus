/**
 * ARGUS — InfoTip (specs/02-ui-dashboard.md §3)
 * ⓘ button that holds long explanations so cards stay low-text.
 * Opens on hover, focus or click; closes on Esc, blur or outside click (WCAG 1.4.13).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTipProps {
  label: string;
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export const InfoTip: React.FC<InfoTipProps> = ({ label, children, align = 'center', className = '' }) => {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const pos =
    align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
          setOpen((o) => (pinned ? !o : true));
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        className="hud-focus inline-flex items-center justify-center w-6 h-6 rounded-full text-hud-muted hover:text-hud-accent"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`absolute top-full mt-1.5 z-50 w-64 max-w-[80vw] rounded-lg border border-hud-line bg-hud-bg/95 px-3 py-2 text-xs leading-relaxed text-hud-text shadow-2xl backdrop-blur-md ${pos}`}
        >
          {children}
        </span>
      )}
    </span>
  );
};
