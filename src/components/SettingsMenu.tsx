/**
 * ARGUS — Settings menu in the top bar. For now: test the emergency alert.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Settings, Siren } from 'lucide-react';
import { triggerTestAlert } from './LifeThreatAlert';

export const SettingsMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        title="Settings"
        className="hud-focus rounded-lg border border-hud-line bg-hud-panel/80 p-1.5 text-hud-muted hover:text-hud-text"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="hud-card absolute right-0 top-full z-50 mt-1 w-64 p-2">
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-hud-muted">Settings</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              triggerTestAlert();
            }}
            className="hud-focus flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-hud-text hover:bg-hud-bg"
          >
            <Siren className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <span>
              Test emergency alert
              <span className="block text-[11px] text-hud-muted">Shows the alert and plays the alarm. Nothing is logged.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
