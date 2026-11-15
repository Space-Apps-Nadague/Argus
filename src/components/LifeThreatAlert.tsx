/**
 * ARGUS — Life-threat alarm (specs/02-ui-dashboard.md §7)
 *
 * When the active crew member's latest reading is possible but immediately dangerous
 * (`LIFE_THREAT_LIMITS`, e.g. 42 °C body temperature), a full-screen ALERT covers the HUD.
 * One alarm sound plays when the alert appears. The alert stays until the crew presses
 * "I acknowledge". A new value for the same metric raises a new alert.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { playAlarmTone, primeAlarmAudio } from '../utils/alarmTone';

const ACK_STORAGE_KEY = 'argus_life_threat_ack_v1';

function loadAcks(): Set<string> {
  try {
    const raw = sessionStorage.getItem(ACK_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveAcks(acks: Set<string>): void {
  try {
    sessionStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...acks]));
  } catch {
    /* storage unavailable: acknowledgement lasts for this page view */
  }
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export const LifeThreatAlert: React.FC = () => {
  const { lifeThreats, activeCrewMember } = useMission();
  const [acks, setAcks] = useState<Set<string>>(loadAcks);
  const played = useRef<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);

  const pending = useMemo(() => lifeThreats.filter((t) => !acks.has(t.key)), [lifeThreats, acks]);
  const pendingSignature = pending.map((t) => t.key).join(',');

  useEffect(() => primeAlarmAudio(), []);

  useEffect(() => {
    const fresh = pending.filter((t) => !played.current.has(t.key));
    if (!fresh.length) return;
    fresh.forEach((t) => played.current.add(t.key));
    playAlarmTone();
    buttonRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSignature]);

  if (!pending.length) return null;

  const acknowledge = () => {
    const next = new Set(acks);
    pending.forEach((t) => next.add(t.key));
    saveAcks(next);
    setAcks(next);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="life-threat-title"
      aria-describedby="life-threat-list"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-red-950/90 p-4 backdrop-blur-sm"
    >
      <div className="absolute inset-0 animate-pulse bg-red-600/20" aria-hidden="true" />
      <div className="relative w-full max-w-2xl rounded-2xl border-4 border-red-500 bg-black/80 p-6 text-center shadow-[0_0_80px_rgba(239,68,68,0.6)] sm:p-8">
        <AlertTriangle className="mx-auto h-16 w-16 text-red-500" aria-hidden="true" />
        <h2 id="life-threat-title" className="mt-2 font-display text-6xl font-bold tracking-[0.2em] text-red-500 sm:text-8xl">
          ALERT
        </h2>
        <p className="mt-2 text-lg font-semibold uppercase tracking-wider text-red-200">
          Life-threatening reading · {activeCrewMember.callsign}
        </p>

        <ul id="life-threat-list" className="mt-6 space-y-3 text-left">
          {pending.map((t) => (
            <li key={t.key} className="rounded-xl border border-red-500/60 bg-red-500/10 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-white">{t.label}</span>
                <span className="font-mono text-3xl font-bold text-red-400">
                  {formatValue(t.value)} <span className="text-base">{t.unit}</span>
                </span>
              </div>
              <p className="mt-1 text-sm text-red-200">
                {t.direction === 'high' ? 'At or above' : 'At or below'} the life-threat limit of {t.limit} {t.unit}.
              </p>
              <p className="mt-2 text-base text-white">{t.action}</p>
            </li>
          ))}
        </ul>

        <button
          ref={buttonRef}
          type="button"
          onClick={acknowledge}
          className="mt-6 w-full rounded-xl bg-red-600 px-6 py-4 text-xl font-bold uppercase tracking-wider text-white hover:bg-red-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-white"
        >
          I acknowledge
        </button>
        <p className="mt-2 text-xs text-red-200/80">The alert stays on screen until acknowledged.</p>
      </div>
    </div>
  );
};
