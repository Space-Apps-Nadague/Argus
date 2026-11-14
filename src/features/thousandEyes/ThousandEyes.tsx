/**
 * ARGOS — The Thousand Eyes ring.
 * One "eye" per indicator around a ring, ordered by body system. The eye's colour is its status vs.
 * the person's OWN baseline; the pupil grows with severity. Violet curves are statistically found
 * links. Values are never shown on the ring: click / tap / Enter on an eye to open its details.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RING_ORDER, SYSTEM_COLORS } from './indicators';
import { LOCATION_LABEL } from './locationShift';
import { allStatuses, deviationIndex, findLinks, fmt, indicatorStatus, linkText, readiness } from './science';
import { readinessColor, statusStyle } from './statusColors';
import type { IndicatorStatus, Person } from './types';
import { EyePopover } from './EyePopover';

// Geometry: eyes ~36% bigger than the prototype (rx 11 -> 15, ry 6 -> 8.5); ring and viewBox grown to fit.
const VIEW = 540;
const C = VIEW / 2;
const R = 196;
const EYE_RX = 15;
const EYE_RY = 8.5;
const HIT_R = 19; // invisible, generous click/tap target
const LABEL_R = R + 32;

const angle = (i: number, n: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;

export interface ThousandEyesProps {
  person: Person;
  /** Evaluation time (ms). Passed in so the component stays pure and testable. */
  now: number;
  /** Optional override for the location name shown in the details box. */
  locationLabel?: string;
  className?: string;
}

export const ThousandEyes: React.FC<ThousandEyesProps> = ({ person, now, locationLabel, className }) => {
  const statuses = useMemo(
    () => RING_ORDER.map((ind) => indicatorStatus(person, ind.key, now)),
    [person, now]
  );
  const withData = useMemo(() => allStatuses(person, now), [person, now]);
  const links = useMemo(() => findLinks(person), [person]);
  const score = readiness(withData);
  const pdi = deviationIndex(withData);

  const n = RING_ORDER.length;
  const pos = (i: number) => {
    const a = angle(i, n);
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a), deg: (a * 180) / Math.PI, a };
  };
  const indexOf = useMemo(() => new Map(RING_ORDER.map((ind, i) => [ind.key, i])), []);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const eyeRefs = useRef<Record<string, SVGGElement | null>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenKey((k) => {
      if (k) window.setTimeout(() => eyeRefs.current[k]?.focus(), 0);
      return null;
    });
  }, []);

  const open: IndicatorStatus | undefined = openKey ? statuses.find((s) => s.key === openKey) : undefined;
  const openPos = openKey != null ? pos(indexOf.get(openKey) ?? 0) : null;

  return (
    <div ref={wrapRef} className={`thousand-eyes relative mx-auto w-full max-w-[560px] ${className ?? ''}`}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="block w-full select-none" role="group" aria-label="The Thousand Eyes: one eye per indicator, coloured by status against your own baseline">
        <circle className="te-spin" cx={C} cy={C} r={R + 52} fill="none" stroke="#4dd0ff44" strokeDasharray="2 9" />
        <circle cx={C} cy={C} r={R - 52} fill="none" stroke="#1e2b3c" />

        {links.map((l) => {
          const ia = indexOf.get(l.a);
          const ib = indexOf.get(l.b);
          if (ia == null || ib == null) return null;
          const a = pos(ia);
          const b = pos(ib);
          return (
            <path
              key={`${l.a}-${l.b}-${l.lagDays}`}
              d={`M${a.x} ${a.y}Q${C} ${C} ${b.x} ${b.y}`}
              fill="none"
              stroke="#9b7bff"
              strokeWidth={1 + 3 * Math.abs(l.r)}
              opacity={0.5}
              pointerEvents="none"
            >
              <desc>{linkText(l)}</desc>
            </path>
          );
        })}

        {RING_ORDER.map((ind, i) => {
          const p = pos(i);
          const s = statuses[i];
          const st = statusStyle(s.n ? s.status : undefined);
          const pupil = s.n ? 3.2 + Math.min(s.badness, 3) * 1.1 : 2.4;
          const isOpen = openKey === ind.key;
          const lx = C + LABEL_R * Math.cos(p.a);
          const ly = C + LABEL_R * Math.sin(p.a);
          const flag = s.n && s.status ? (s.status === 2 ? '!' : '▲') : '';
          const toggle = () => setOpenKey((k) => (k === ind.key ? null : ind.key));
          return (
            <g key={ind.key}>
              <g
                ref={(el) => {
                  eyeRefs.current[ind.key] = el;
                }}
                className="te-eye cursor-pointer outline-none"
                transform={`translate(${p.x} ${p.y})`}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-label={`${ind.label} (${ind.system}): ${st.text}. Open details`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <circle r={HIT_R} fill="transparent" />
                <g transform={`rotate(${p.deg})`}>
                  <ellipse
                    className="te-eye-shape"
                    rx={EYE_RX}
                    ry={EYE_RY}
                    fill="#0A0E14"
                    stroke={isOpen ? '#e6edf3' : st.color}
                    strokeWidth={isOpen ? 2.5 : 1.8}
                  />
                  <circle className={`te-pupil te-pulse-${i % 4}`} r={pupil} fill={st.color} />
                </g>
              </g>
              <text
                x={lx}
                y={ly + 3}
                fontSize={8.5}
                fill={SYSTEM_COLORS[ind.system]}
                textAnchor="middle"
                pointerEvents="none"
                fontWeight={isOpen ? 700 : 500}
              >
                {ind.key.toUpperCase()}
                {flag && (
                  <tspan fill={st.color} dx={2}>
                    {flag}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}

        <text x={C} y={C - 6} textAnchor="middle" fontSize={56} fontWeight={800} fill={readinessColor(score)} style={{ fontFamily: 'Orbitron, sans-serif' }}>
          {score == null ? '–' : score}
        </text>
        <text x={C} y={C + 18} textAnchor="middle" fontSize={10.5} fill="#7d8fa3" letterSpacing={1}>
          PERSONAL READINESS
        </text>
        <text x={C} y={C + 36} textAnchor="middle" fontSize={10.5} fill="#7d8fa3">
          deviation index {fmt(pdi, 2)} σ
        </text>
      </svg>

      {open && openPos && (
        <EyePopover
          status={open}
          anchor={{ xPct: (openPos.x / VIEW) * 100, yPct: (openPos.y / VIEW) * 100 }}
          locationLabel={locationLabel ?? LOCATION_LABEL[person.env]}
          containerRef={wrapRef}
          onClose={close}
        />
      )}

      <style>{`
        .thousand-eyes .te-eye:focus-visible .te-eye-shape { stroke: #22d3ee; stroke-width: 3; }
        .thousand-eyes .te-eye:hover .te-eye-shape { stroke-width: 2.6; }
        .thousand-eyes .te-pupil { animation: te-pulse 3s ease-in-out infinite; }
        .thousand-eyes .te-pulse-1 { animation-duration: 3.5s; }
        .thousand-eyes .te-pulse-2 { animation-duration: 4s; }
        .thousand-eyes .te-pulse-3 { animation-duration: 4.5s; }
        .thousand-eyes .te-spin { transform-origin: ${C}px ${C}px; animation: te-spin 120s linear infinite; }
        @keyframes te-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @keyframes te-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .thousand-eyes .te-pupil, .thousand-eyes .te-spin { animation: none; }
        }
      `}</style>
    </div>
  );
};
