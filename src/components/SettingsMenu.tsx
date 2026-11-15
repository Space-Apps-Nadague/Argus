/**
 * ARGUS — Settings menu in the top bar: test the emergency alert, and the spacecraft scenarios where
 * ARGUS changes the ship's (simulated) systems and explains it out loud.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Satellite, Settings, Siren } from 'lucide-react';
import { triggerTestAlert } from './LifeThreatAlert';
import { triggerSpacecraftEvent } from './SpacecraftAlert';
import { SPACECRAFT_EVENT_IDS, SPACECRAFT_EVENTS } from '../features/spacecraft/habitat';

export const SettingsMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // The menu is drawn in a portal above everything: the top bar's own layer would otherwise let
  // the page content cover the lower part of the list.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
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
      {open &&
        pos &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="hud-card fixed z-[150] max-h-[calc(100vh-5rem)] w-72 overflow-y-auto p-2"
          style={{ top: pos.top, right: pos.right }}
        >
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
          <p className="mt-2 border-t border-hud-line px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-hud-muted">
            Spacecraft · ARGUS takes action (demo)
          </p>
          {SPACECRAFT_EVENT_IDS.map((id) => {
            const ev = SPACECRAFT_EVENTS[id];
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  triggerSpacecraftEvent(id);
                }}
                className="hud-focus flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-hud-text hover:bg-hud-bg"
              >
                <Satellite className={`mt-0.5 h-4 w-4 shrink-0 ${ev.severity === 'red' ? 'text-red-400' : 'text-amber-400'}`} aria-hidden="true" />
                <span>
                  {ev.title}
                  <span className="block text-[11px] text-hud-muted">
                    {ev.reading.value} {ev.reading.unit} in {ev.module} · {ev.actions.filter((a) => a.tier === 'auto').length} automatic, {ev.actions.filter((a) => a.tier === 'confirm').length} to confirm
                  </span>
                </span>
              </button>
            );
          })}
        </div>,
          document.body
        )}
    </div>
  );
};
