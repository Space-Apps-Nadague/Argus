/**
 * ARGUS — Emergency alert (specs/02-ui-dashboard.md §7)
 *
 * When the active crew member's latest reading is possible but immediately dangerous
 * (`LIFE_THREAT_LIMITS`, e.g. 42 °C body temperature), an EMERGENCY ALERT card pops up over
 * whatever tab is open; a fever of 38.5 °C or more raises an amber HEALTH ALERT the same way.
 * Sound: one beep + "Alert", then a voice says what was detected and what to do. One alarm beep plays when it appears, then a voice says what is wrong and
 * what to do ("Emergency alert. Body temperature 42 degrees Celsius. Stop all work…"). It stays until the crew presses
 * OK. A new value for the same metric raises a new alert. Settings → "Test emergency alert"
 * shows a clearly labelled test alert (`triggerTestAlert`).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMission } from '../context/MissionContext';
import { alertSpeech, primeAlarmAudio, runAlertSequence } from '../utils/alarmTone';
import { FEVER_ACTION, FEVER_LIMIT_C, type LifeThreat } from '../utils/vitalLimits';

const ACK_STORAGE_KEY = 'argus_life_threat_ack_v1';
const TEST_EVENT = 'argus:test-emergency-alert';

/** Shows a test EMERGENCY ALERT (Settings menu). Nothing is logged or sent. */
export function triggerTestAlert(): void {
  window.dispatchEvent(new CustomEvent(TEST_EVENT));
}

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

const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const testThreat = (): LifeThreat => ({
  zoneId: 'immune',
  metricId: 'core_temp',
  label: 'Body temperature',
  unit: '°C',
  value: 38.5,
  direction: 'high',
  limit: FEVER_LIMIT_C,
  action: FEVER_ACTION,
  severity: 'yellow',
  key: `test|${Date.now()}`,
});

export const LifeThreatAlert: React.FC = () => {
  const { lifeThreats, activeCrewMember } = useMission();
  const [acks, setAcks] = useState<Set<string>>(loadAcks);
  const [tests, setTests] = useState<LifeThreat[]>([]);
  const played = useRef<Set<string>>(new Set());
  const stopSpeech = useRef<() => void>(() => undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => primeAlarmAudio(), []);
  useEffect(() => {
    const onTest = () => setTests([testThreat()]);
    window.addEventListener(TEST_EVENT, onTest);
    return () => window.removeEventListener(TEST_EVENT, onTest);
  }, []);

  const pending = useMemo(() => [...lifeThreats.filter((t) => !acks.has(t.key)), ...tests], [lifeThreats, acks, tests]);
  const isTest = pending.length > 0 && pending.every((t) => t.key.startsWith('test|'));
  const signature = pending.map((t) => t.key).join(',');
  // Red for a life-threatening reading; amber when everything pending is a yellow alert (fever).
  const red = pending.some((t) => t.severity === 'red');
  const colour = red ? '#e10600' : '#d97706';

  useEffect(() => {
    const fresh = pending.filter((t) => !played.current.has(t.key));
    if (!fresh.length) return;
    fresh.forEach((t) => played.current.add(t.key));
    stopSpeech.current();
    stopSpeech.current = runAlertSequence(alertSpeech(pending, activeCrewMember.callsign));
    buttonRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (!pending.length) return null;

  const acknowledge = () => {
    stopSpeech.current();
    const next = new Set(acks);
    pending.filter((t) => !t.key.startsWith('test|')).forEach((t) => next.add(t.key));
    saveAcks(next);
    setAcks(next);
    setTests([]);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-alert-title"
      aria-describedby="emergency-alert-list"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
    >
      {/* Red blob behind the card, as on a phone emergency alert */}
      <svg viewBox="0 0 600 600" className="pointer-events-none absolute h-[min(110vw,110vh)] w-[min(110vw,110vh)] animate-pulse" aria-hidden="true">
        <path
          fill={colour}
          d="M318 34c97 4 205 52 236 146 30 92-34 168-58 256-21 77-62 141-146 152-92 12-196-28-250-104C46 410 30 319 62 238c34-87 74-150 136-182 38-20 76-24 120-22z"
        />
      </svg>

      <div className="relative w-full max-w-sm rounded-[2rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl">
        <div className={`rounded-[1.4rem] border-4 ${red ? 'border-red-600' : 'border-amber-500'} bg-white px-6 pb-6 pt-7 text-center`}>
          {isTest && (
            <p className="mb-2 inline-block rounded-full bg-neutral-200 px-3 py-0.5 text-xs font-bold uppercase tracking-widest text-neutral-700">
              Test · not a real reading
            </p>
          )}
          <svg viewBox="0 0 100 88" className="mx-auto h-20 w-24" aria-hidden="true">
            <path d="M50 4 L96 84 H4 Z" fill={colour} stroke={colour} strokeWidth="6" strokeLinejoin="round" />
            <rect x="45" y="28" width="10" height="34" rx="4" fill="#fff" />
            <circle cx="50" cy="72" r="5.5" fill="#fff" />
          </svg>
          <h2 id="emergency-alert-title" className="mt-2 font-sans font-black uppercase leading-none" style={{ color: colour }}>
            <span className="block text-3xl tracking-wide">{red ? 'Emergency' : 'Health'}</span>
            <span className="block text-6xl tracking-wide">Alert</span>
          </h2>
          <p className="mt-3 text-sm font-semibold uppercase tracking-wider text-neutral-700">
            {red ? 'Life-threatening reading' : 'Act now'} · {activeCrewMember.callsign}
          </p>

          <ul id="emergency-alert-list" className="mt-4 space-y-3 text-left">
            {pending.map((t) => (
              <li key={t.key} className="rounded-xl bg-neutral-100 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-neutral-900">{t.label}</span>
                  <span className="font-mono text-2xl font-bold" style={{ color: t.severity === 'red' ? '#e10600' : '#d97706' }}>
                    {formatValue(t.value)} <span className="text-sm">{t.unit}</span>
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  {t.direction === 'high' ? 'At or above' : 'At or below'} the {t.severity === 'red' ? 'life-threat' : 'fever'} limit of {t.limit} {t.unit}.
                </p>
                <p className="mt-1 text-sm font-medium text-neutral-900">{t.action}</p>
              </li>
            ))}
          </ul>

          <button
            ref={buttonRef}
            type="button"
            onClick={acknowledge}
            aria-label="OK, I acknowledge the emergency alert"
            className="mx-auto mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-500 text-lg font-bold text-white shadow hover:bg-neutral-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-500"
          >
            OK
          </button>
          <p className="mt-2 text-[11px] text-neutral-500">Stays on screen until you press OK.</p>
        </div>
      </div>
    </div>
  );
};
