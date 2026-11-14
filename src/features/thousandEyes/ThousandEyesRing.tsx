/**
 * ARGUS — Thousand Eyes 31-Indicator SVG Ring
 * Ported from ARGOS_The_Thousand_Eyes.html (specs/02-ui-dashboard.md §2.4b).
 *
 * - 31 eyes ordered by 12 body systems
 * - Bigger eyes + generous hit targets, no numeric values cluttered on the ring
 * - Non-color status cues (shape + ring + ARIA label)
 * - Roving tabIndex + Arrow/Home/End/Enter/Space keyboard navigation
 */

import React, { useMemo, useRef, useState } from 'react';
import { BODY_SYSTEM_META, BODY_SYSTEM_ORDER } from './indicators';
import { formatHiddenLink } from './engine';
import { EYE_STATUS_LABEL } from './EyeStatusBadge';
import type {
  BodySystemId,
  EyeStat,
  EyeStatus,
  HiddenLink,
  ThousandEyesIndicatorId,
} from './types';

const SIZE = 640;
const C = SIZE / 2;
const RING_R = 224;
const LABEL_R = 266;
const ARC_R = 172;
const DRIFT_COLOR = '#a78bfa';

const STATUS_HEX: Record<EyeStatus, string> = {
  nodata: '#64748b',
  nominal: '#22c55e',
  drifting: '#eab308',
  red_flag: '#ef4444',
};

const polar = (r: number, a: number): [number, number] => [
  C + r * Math.cos(a),
  C + r * Math.sin(a),
];

function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function readinessColor(score: number | null): string {
  if (score === null) return '#64748b';
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#eab308';
  return '#ef4444';
}

interface ThousandEyesRingProps {
  stats: readonly EyeStat[];
  links: readonly HiddenLink[];
  readinessScore: number | null;
  deviationIndex: number | null;
  selectedId: ThousandEyesIndicatorId | null;
  onSelect: (id: ThousandEyesIndicatorId) => void;
  callsign?: string;
}

export const ThousandEyesRing: React.FC<ThousandEyesRingProps> = ({
  stats,
  links,
  readinessScore,
  deviationIndex,
  selectedId,
  onSelect,
  callsign,
}) => {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const eyeRefs = useRef<Array<SVGGElement | null>>([]);

  const { nodes, systemArcs, byId } = useMemo(() => {
    const n = stats.length;
    const step = (Math.PI * 2) / n;
    const computed = stats.map((stat, i) => {
      const angle = -Math.PI / 2 + i * step;
      const [x, y] = polar(RING_R, angle);
      const [lx, ly] = polar(LABEL_R, angle);
      return {
        stat,
        idx: i,
        angle,
        deg: (angle * 180) / Math.PI,
        x,
        y,
        lx,
        ly,
      };
    });

    const arcs: Array<{ system: BodySystemId; a0: number; a1: number }> = [];
    BODY_SYSTEM_ORDER.forEach((sys) => {
      const matching = computed.filter((node) => node.stat.indicator.system === sys);
      if (!matching.length) return;
      const first = matching[0].angle - step * 0.32;
      const last = matching[matching.length - 1].angle + step * 0.32;
      arcs.push({ system: sys, a0: first, a1: last });
    });

    const map = new Map(computed.map((node) => [node.stat.indicator.id, node]));
    return { nodes: computed, systemArcs: arcs, byId: map };
  }, [stats]);

  const activeCount = useMemo(
    () => stats.filter((s) => s.status !== 'nodata').length,
    [stats]
  );
  const noDataCount = stats.length - activeCount;

  const moveFocus = (nextIdx: number) => {
    const wrapped = (nextIdx + nodes.length) % nodes.length;
    setFocusedIdx(wrapped);
    eyeRefs.current[wrapped]?.focus();
  };

  const handleKeyDown = (ev: React.KeyboardEvent, idx: number, id: ThousandEyesIndicatorId) => {
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        ev.preventDefault();
        moveFocus(idx + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        ev.preventDefault();
        moveFocus(idx - 1);
        break;
      case 'Home':
        ev.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        ev.preventDefault();
        moveFocus(nodes.length - 1);
        break;
      case 'Enter':
      case ' ':
        ev.preventDefault();
        onSelect(id);
        break;
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative mx-auto w-full max-w-[620px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="block w-full h-auto select-none"
          role="group"
          aria-label={`Thousand Eyes ring of ${stats.length} physiological and habitat indicators. Use arrow keys to move between eyes and Enter to inspect details.`}
        >
          {/* Outer subtle orbital guide */}
          <circle
            cx={C}
            cy={C}
            r={RING_R + 30}
            fill="none"
            stroke="#1e293b"
            strokeDasharray="3 8"
            strokeWidth={1.2}
          />
          <circle cx={C} cy={C} r={ARC_R - 14} fill="none" stroke="#1e293b" strokeWidth={1} />

          {/* Body system arcs */}
          {systemArcs.map(({ system, a0, a1 }) => (
            <path
              key={system}
              d={arcPath(ARC_R, a0, a1)}
              stroke={BODY_SYSTEM_META[system].color}
              strokeOpacity={0.55}
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            >
              <title>{system}</title>
            </path>
          ))}

          {/* Hidden links (violet quadratic arcs) */}
          {links.map((link) => {
            const a = byId.get(link.from);
            const b = byId.get(link.to);
            if (!a || !b) return null;
            return (
              <path
                key={`${link.from}-${link.to}-${link.lagDays}`}
                d={`M ${a.x} ${a.y} Q ${C} ${C} ${b.x} ${b.y}`}
                fill="none"
                stroke={DRIFT_COLOR}
                strokeWidth={1.2 + Math.abs(link.r) * 2.5}
                strokeOpacity={0.35 + Math.abs(link.r) * 0.4}
              >
                <title>{formatHiddenLink(link)}</title>
              </path>
            );
          })}

          {/* Center Readiness & Deviation Index */}
          <text
            x={C}
            y={C - 16}
            textAnchor="middle"
            fontSize={52}
            fontWeight={800}
            fill={readinessColor(readinessScore)}
            style={{ fontFamily: 'Orbitron, Inter, sans-serif' }}
          >
            {readinessScore === null ? '–' : `${readinessScore}`}
          </text>
          <text
            x={C}
            y={C + 10}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            letterSpacing="0.12em"
            fill="#94a3b8"
          >
            {callsign ? `${callsign.toUpperCase()} READINESS` : 'PERSONAL READINESS'}
          </text>
          <text
            x={C}
            y={C + 30}
            textAnchor="middle"
            fontSize={12}
            fill="#cbd5e1"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            {deviationIndex === null
              ? 'deviation index –'
              : `deviation index ${deviationIndex.toFixed(2)} σ`}
          </text>
          <text x={C} y={C + 48} textAnchor="middle" fontSize={10.5} fill="#64748b">
            {`${activeCount} active · ${noDataCount} no data`}
          </text>

          {/* 31 Eyes */}
          {nodes.map(({ stat, idx, angle, deg, x, y, lx, ly }) => {
            const { indicator, status, ewmaZ, currentValue } = stat;
            const color = STATUS_HEX[status];
            const isSelected = selectedId === indicator.id;
            const pupilShift =
              ewmaZ === null ? 0 : Math.max(-4.5, Math.min(4.5, ewmaZ * 1.5));
            const cos = Math.cos(angle);
            const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
            const ariaValue =
              status === 'nodata' || currentValue === null
                ? 'no data'
                : `${Number(currentValue.toFixed(2))} ${indicator.unit}`;

            return (
              <g key={indicator.id}>
                <g
                  ref={(el) => {
                    eyeRefs.current[idx] = el;
                  }}
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={idx === focusedIdx ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-label={`${indicator.label} (${indicator.system}): ${ariaValue}, ${EYE_STATUS_LABEL[status]}`}
                  onClick={() => {
                    setFocusedIdx(idx);
                    onSelect(indicator.id);
                  }}
                  onFocus={() => setFocusedIdx(idx)}
                  onKeyDown={(ev) => handleKeyDown(ev, idx, indicator.id)}
                  className="cursor-pointer outline-none group"
                >
                  {/* Generous invisible hit area for easy click/tap (WCAG 2.5.8) */}
                  <circle r={22} fill="transparent" />

                  {/* Keyboard focus-visible ring */}
                  <circle
                    r={24}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth={2.5}
                    className="opacity-0 group-focus-visible:opacity-100 transition-opacity"
                  />

                  {/* Selection ring */}
                  {isSelected && (
                    <circle
                      r={21}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      strokeOpacity={0.9}
                    />
                  )}

                  {/* Non-color status outer cue: dashed ring for drifting, solid double halo for red_flag */}
                  {status === 'drifting' && (
                    <circle
                      r={19}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.6}
                      strokeDasharray="3.5 3"
                    />
                  )}
                  {status === 'red_flag' && (
                    <circle r={19.5} fill="none" stroke={color} strokeWidth={2} />
                  )}

                  {/* Rotated eye body */}
                  <g transform={`rotate(${deg})`}>
                    <ellipse
                      rx={16}
                      ry={9.5}
                      fill="#020617"
                      stroke={color}
                      strokeWidth={status === 'red_flag' ? 2.4 : status === 'nodata' ? 1.3 : 1.8}
                      strokeDasharray={status === 'nodata' ? '3 2.5' : undefined}
                    />

                    {/* Pupil / Iris shape encodes status without color alone */}
                    {status === 'nodata' && (
                      <circle r={2.3} fill="none" stroke={color} strokeWidth={1.3} />
                    )}
                    {status === 'nominal' && (
                      <>
                        <circle cx={pupilShift} cy={0} r={5.2} fill={color} />
                        <circle cx={pupilShift} cy={0} r={2.1} fill="#020617" />
                      </>
                    )}
                    {status === 'drifting' && (
                      <polygon
                        points={`${pupilShift}, -5.5 ${pupilShift + 5.5}, 0 ${pupilShift}, 5.5 ${pupilShift - 5.5}, 0`}
                        fill={color}
                      />
                    )}
                    {status === 'red_flag' && (
                      <>
                        <circle cx={pupilShift} cy={0} r={5.8} fill={color} />
                        <path
                          d={`M ${pupilShift - 2.6} -2.6 L ${pupilShift + 2.6} 2.6 M ${pupilShift + 2.6} -2.6 L ${pupilShift - 2.6} 2.6`}
                          stroke="#020617"
                          strokeWidth={1.6}
                          strokeLinecap="round"
                        />
                      </>
                    )}
                  </g>

                  <title>
                    {`${indicator.label} (${indicator.system}): ${ariaValue} · ${EYE_STATUS_LABEL[status]}`}
                  </title>
                </g>

                {/* Short code label outside ring (no numeric values on ring) */}
                <text
                  x={lx}
                  y={ly + 3.5}
                  textAnchor={anchor}
                  fontSize={9.5}
                  fontWeight={isSelected ? 700 : 600}
                  fill={status === 'nodata' ? '#64748b' : BODY_SYSTEM_META[indicator.system].color}
                  className="pointer-events-none"
                >
                  {indicator.id.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Non-color legend */}
      <ul
        className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-hud-muted"
        aria-label="Ring status legend"
      >
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-status-green" aria-hidden="true" />
          <span>On baseline (circle)</span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rotate-45 border border-status-yellow bg-status-yellow/80"
            aria-hidden="true"
          />
          <span>Drifting (diamond + dashed ring)</span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border-2 border-status-red bg-status-red/60"
            aria-hidden="true"
          />
          <span>Red flag (alert halo)</span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-slate-500"
            aria-hidden="true"
          />
          <span>No data (grey)</span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-hud-drift" aria-hidden="true" />
          <span>Hidden link</span>
        </li>
      </ul>
    </div>
  );
};
