/**
 * ARGUS — Central Hero 3D Holographic Anatomical Bio-Twin (`BioTwinMap.tsx`)
 * Single Source of Truth: specs/02-ui-dashboard.md (§1 Center Hero Column — 46%)
 *
 * Features:
 * - Central hero-stage interactive 3D Sculpted Human Bio-Twin differentiating Female (`'female'`)
 *   and Male (`'male'`) anatomies across dermal/muscular contours, skeletal pelvis/ribcage/Q-angle,
 *   and internal visceral/vascular systems.
 * - Camera Focus Presets (`Full Body`, `Cranial / SANS`, `Thorax / Core`), auto-rotate toggle,
 *   and holographic scanner sweep.
 * - Anatomical Layer Switcher (`All Layers`, `Dermal / Surface`, `Skeletal / Musculoskeletal`, `Organs / Vascular`).
 * - 6 clickable 3D anatomical regions (`neuro`, `cardio`, `musculo`, `metabolic`, `immune`, `behavioral`)
 *   dynamically colored by deterministic `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`).
 */

import React, { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, AdaptiveEvents, Bvh, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Activity,
  Bone,
  Brain,
  Crosshair,
  Eye,
  Flame,
  HeartPulse,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { StatusIcon, StatusPill, STATUS_WORD } from './ui/StatusPill';
import { ZONE_SHORT_NAME } from './ui/ZoneIcon';
import {
  AnatomicalLayer,
  BiologicalSex,
  BodyZoneId,
  TriageStatus,
} from '../types/argus';
import { BODY_ZONES, ZONE_ORDER } from '../data/telemetryScenarios';
import {
  evaluateMetricStatus,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../utils/triageEngine';
import { OrganTwinModel } from '../features/organs/OrganTwinModel';
import { OrganPanel } from '../features/organs/OrganPanel';
import { ORGAN_BY_ID, organStates, PEEL_LEVELS, type OrganId, type PeelLevel } from '../features/organs/organs';
import { buildPerson } from '../features/thousandEyes/adapter';
import type { Status } from '../features/thousandEyes/types';

type CameraPresetId = 'full_body' | 'cranial_sans' | 'thorax_core';

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { label: string; position: [number, number, number]; target: [number, number, number] }
> = {
  full_body: {
    label: 'Full Body',
    position: [0, 0.05, 4.35],
    target: [0, -0.05, 0],
  },
  cranial_sans: {
    label: 'Cranial / SANS',
    position: [0, 1.55, 1.95],
    target: [0, 1.52, 0],
  },
  thorax_core: {
    label: 'Thorax / Core',
    position: [0, 0.55, 2.45],
    target: [0, 0.48, 0],
  },
};

const STATUS_TO_TRIAGE: Record<Status, TriageStatus> = { 0: 'green', 1: 'yellow', 2: 'red' };

const ZONE_ICONS: Record<BodyZoneId, React.ReactNode> = {
  neuro: <Brain className="w-3.5 h-3.5" aria-hidden="true" />,
  cardio: <HeartPulse className="w-3.5 h-3.5" aria-hidden="true" />,
  musculo: <Bone className="w-3.5 h-3.5" aria-hidden="true" />,
  metabolic: <Flame className="w-3.5 h-3.5" aria-hidden="true" />,
  immune: <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />,
  behavioral: <Eye className="w-3.5 h-3.5" aria-hidden="true" />,
};

interface WebGLErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
}

class WebGLErrorBoundary extends Component<
  WebGLErrorBoundaryProps,
  WebGLErrorBoundaryState
> {
  constructor(props: WebGLErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): WebGLErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface CameraControllerProps {
  preset: CameraPresetId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}

const CameraPresetController: React.FC<CameraControllerProps> = ({
  preset,
  controlsRef,
}) => {
  const { camera } = useThree();

  useEffect(() => {
    const cfg = CAMERA_PRESETS[preset];
    camera.position.set(...cfg.position);
    if (controlsRef.current) {
      controlsRef.current.target.set(...cfg.target);
      controlsRef.current.update();
    }
  }, [preset, camera, controlsRef]);

  return null;
};


export const BioTwinMap: React.FC = () => {
  const {
    activeCrewMember,
    updateCrewMemberSex,
    setCrewModalOpen,
    selectedZone,
    setSelectedZone,
    setSelectedMetricId,
    zoneStatuses,
    currentZoneReadings,
    environment,
    readinessScore,
    zones,
    spaceLocationId,
    spaceLocation,
  } = useMission();

  const [hoveredOrgan, setHoveredOrgan] = useState<OrganId | null>(null);
  const [selectedOrgan, setSelectedOrgan] = useState<OrganId | null>(null);
  const [peel, setPeel] = useState<PeelLevel>('body');
  // Moving the pointer across the gaps between bones fires pointerout/pointerover many times a
  // second. Updating state on each one re-rendered the whole model and toggled auto-rotate (lag +
  // flicker). Keep the hover for a short grace period and skip no-op updates.
  const hoverClearTimer = useRef<number | null>(null);
  const handleHoverOrgan = useCallback((organ: OrganId | null) => {
    if (hoverClearTimer.current !== null) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    if (organ) {
      document.body.style.cursor = 'pointer';
      setHoveredOrgan((prev) => (prev === organ ? prev : organ));
      return;
    }
    hoverClearTimer.current = window.setTimeout(() => {
      hoverClearTimer.current = null;
      document.body.style.cursor = 'auto';
      setHoveredOrgan(null);
    }, 150);
  }, []);
  useEffect(
    () => () => {
      if (hoverClearTimer.current !== null) window.clearTimeout(hoverClearTimer.current);
      document.body.style.cursor = 'auto';
    },
    []
  );
  // Organ status = worst of its Thousand Eyes indicators vs. the personal baseline.
  const organNow = useMemo(() => Date.now(), [zones, spaceLocationId]);
  const organs = useMemo(() => {
    const person = buildPerson({
      locationId: spaceLocationId,
      metrics: ZONE_ORDER.flatMap((z) => zones[z]),
      now: organNow,
    });
    return organStates(person, organNow);
  }, [zones, spaceLocationId, organNow]);
  const organStatus = useMemo(
    () => Object.fromEntries(Object.entries(organs).map(([id, o]) => [id, o.status])) as Record<OrganId, Status | undefined>,
    [organs]
  );
  const handleSelectOrgan = useCallback(
    (organ: OrganId) => {
      setSelectedOrgan(organ);
      setSelectedZone(ORGAN_BY_ID[organ].zone);
    },
    [setSelectedZone]
  );
  const changePeel = (level: PeelLevel) => {
    setPeel(level);
    setSelectedOrgan((cur) => (cur && ORGAN_BY_ID[cur].levels.includes(level) ? cur : null));
  };

  const [autoRotate, setAutoRotate] = useState<boolean>(
    () => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  );
  const [showScannerBeam, setShowScannerBeam] = useState<boolean>(true);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('full_body');
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const activeSex: BiologicalSex =
    activeCrewMember.sex === 'male' ? 'male' : 'female';

  const handleResetCamera = () => {
    setCameraPreset('full_body');
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  const focusOrgan = hoveredOrgan ?? selectedOrgan;
  const activeZoneId = focusOrgan ? ORGAN_BY_ID[focusOrgan].zone : selectedZone;
  const activeZoneMeta = BODY_ZONES[activeZoneId];
  const focusStatus = focusOrgan ? organStatus[focusOrgan] : undefined;
  const activeZoneStatus = focusStatus != null ? STATUS_TO_TRIAGE[focusStatus] : zoneStatuses[activeZoneId];

  const fallback2DBioMap = (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
      <p className="text-xs font-mono text-cyan-400 mb-3">
        HOLOGRAPHIC BIO-TWIN // INTERACTIVE ZONE MATRIX
      </p>
      <div className="grid grid-cols-1 gap-2 w-full max-w-xs">
        {ZONE_ORDER.map((zId) => {
          const z = BODY_ZONES[zId];
          const st = zoneStatuses[zId];
          return (
            <button
              key={zId}
              type="button"
              onClick={() => setSelectedZone(zId)}
              className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-700"
            >
              <span className="text-xs font-mono font-bold text-slate-100">
                {z.name}
              </span>
              <span
                className="text-xs font-mono font-bold"
                style={{ color: STATUS_COLORS[st] }}
              >
                {STATUS_LABELS[st]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <section
      aria-label="3D Holographic Human Bio-Twin Central Stage"
      className="hud-card flex h-full flex-col overflow-hidden min-w-0"
    >
      {/* Stage toolbar: anatomy · scanner · rotate · reset (labels in tooltips) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line px-4 py-2.5 min-w-0">
        <h2 className="flex flex-wrap items-center gap-2 font-display text-[13px] font-semibold tracking-wide text-hud-text min-w-0">
          <Sparkles className="h-4 w-4 text-hud-accent shrink-0" aria-hidden="true" />
          Bio-Twin
          <span className="font-mono text-xs font-normal text-hud-accent">{activeCrewMember.callsign}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-hud-line bg-hud-bg p-0.5" role="group" aria-label="3D anatomy">
            {(['female', 'male'] as const).map((sexOpt) => (
              <button
                key={sexOpt}
                type="button"
                aria-pressed={activeSex === sexOpt}
                onClick={() => updateCrewMemberSex(activeCrewMember.id, sexOpt)}
                aria-label={sexOpt === 'female' ? 'Female anatomy' : 'Male anatomy'}
                title={sexOpt === 'female' ? 'Female anatomy' : 'Male anatomy'}
                className="hud-seg px-2 text-base leading-none"
              >
                {sexOpt === 'female' ? '♀' : '♂'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowScannerBeam((prev) => !prev)}
            aria-pressed={showScannerBeam}
            aria-label="Scanner sweep"
            title="Scanner sweep"
            className="hud-seg border border-hud-line p-1.5"
          >
            <ScanLine className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setAutoRotate((prev) => !prev)}
            aria-pressed={autoRotate}
            aria-label={autoRotate ? 'Pause rotation' : 'Resume rotation'}
            title={autoRotate ? 'Pause rotation' : 'Resume rotation'}
            className="hud-seg border border-hud-line p-1.5"
          >
            {autoRotate ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            aria-label="Reset view"
            title="Reset view"
            className="hud-seg border border-hud-line p-1.5"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ============================================================
          SECONDARY BAR: ANATOMICAL LAYER SWITCHER + CAMERA FOCUS PRESETS
         ============================================================ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line/70 px-4 py-2 min-w-0">
        {/* Peel: each step removes the outer layer so deeper organs are easy to reach */}
        <div className="flex flex-wrap items-center gap-1 min-w-0" role="group" aria-label="Peel layers">
          <Layers className="mr-1 h-4 w-4 text-hud-muted shrink-0" aria-hidden="true" />
          {PEEL_LEVELS.map((level, i) => (
            <button
              key={level.id}
              type="button"
              onClick={() => changePeel(level.id)}
              title={level.hint}
              aria-pressed={peel === level.id}
              className="hud-seg"
            >
              <span className="mr-1 font-mono text-[10px] text-hud-muted">{i + 1}</span>
              {level.label}
            </button>
          ))}
        </div>

        {/* Camera Focus Presets */}
        <div className="flex flex-wrap items-center gap-1 min-w-0" role="group" aria-label="Camera focus">
          <Crosshair className="mr-1 h-4 w-4 text-hud-muted shrink-0" aria-hidden="true" />
          {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => {
            const active = cameraPreset === presetKey;
            return (
              <button
                key={presetKey}
                type="button"
                onClick={() => setCameraPreset(presetKey)}
                aria-pressed={active}
                className="hud-seg"
              >
                {CAMERA_PRESETS[presetKey].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================================
          CENTRAL EXPANSIVE 3D HOLOGRAPHIC VIEWPORT (STAR OF THE DASHBOARD)
         ============================================================ */}
      <div
        className="relative flex-1 min-h-[320px] sm:min-h-[380px] md:min-h-[440px] lg:min-h-[480px] xl:min-h-[520px] w-full bg-[radial-gradient(ellipse_at_center,_rgba(8,51,68,0.42)_0%,_rgba(2,6,23,0.96)_72%)]"
        onMouseEnter={() => setIsInteracting(true)}
        onMouseLeave={() => {
          setIsInteracting(false);
          setHoveredOrgan(null);
        }}
      >
        {/* Spacecraft HUD Corner Reticles */}
        <div className="pointer-events-none absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-cyan-400/50" />

        <WebGLErrorBoundary fallback={fallback2DBioMap}>
          <Canvas
            camera={{ position: [0, 0.05, 4.35], fov: 42 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            // Cap the pixel ratio: on 2x/3x screens the transparent, double-sided body was being
            // shaded at up to 9x the pixels. Drop further while the user drags (AdaptiveDpr).
            dpr={[1, 1.5]}
            performance={{ min: 0.6 }}
            onPointerMissed={() => setSelectedOrgan(null)}
          >
            <AdaptiveDpr />
            <AdaptiveEvents />
            <ambientLight intensity={0.7} />
            <hemisphereLight
              color="#e0f2fe"
              groundColor="#083344"
              intensity={0.65}
            />
            {/* Key Anatomical Sculpting Light */}
            <directionalLight position={[3.5, 4.5, 4.5]} intensity={1.55} />
            {/* Cyan Rim Light to accentuate muscle & torso/hip contours */}
            <pointLight
              position={[-3.5, 1.5, -2.5]}
              intensity={1.35}
              color="#22d3ee"
            />
            <pointLight
              position={[3.2, -1.5, 2.5]}
              intensity={0.85}
              color="#38bdf8"
            />

            <CameraPresetController
              preset={cameraPreset}
              controlsRef={controlsRef}
            />

            {/* BVH: fast pointer raycasting against the high-poly sculpted meshes. */}
            <Bvh firstHitOnly>
            <OrganTwinModel
              sex={activeSex}
              peel={peel}
              organStatus={organStatus}
              selectedOrgan={selectedOrgan}
              hoveredOrgan={hoveredOrgan}
              onSelectOrgan={handleSelectOrgan}
              onHoverOrgan={handleHoverOrgan}
              showScannerBeam={showScannerBeam}
            />
            </Bvh>

            <OrbitControls
              ref={controlsRef}
              autoRotate={autoRotate && !isInteracting && !hoveredOrgan && !selectedOrgan}
              autoRotateSpeed={1.25}
              regress
              enablePan={false}
              minDistance={1.5}
              maxDistance={6.2}
              minPolarAngle={Math.PI / 6}
              maxPolarAngle={(5 * Math.PI) / 6}
            />
          </Canvas>
        </WebGLErrorBoundary>

        {selectedOrgan && (
          <OrganPanel
            state={organs[selectedOrgan]}
            locationLabel={spaceLocation.label}
            onClose={() => setSelectedOrgan(null)}
          />
        )}

        {/* Bottom overlay: hovered/selected zone */}
        <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between gap-2 rounded-xl border border-hud-line bg-hud-bg/85 px-3.5 py-2 backdrop-blur-md">
          <span className="flex items-center gap-2 text-sm font-medium text-hud-text">
            <Activity className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            {focusOrgan ? ORGAN_BY_ID[focusOrgan].label : activeZoneMeta.name}
          </span>
          <StatusPill status={activeZoneStatus} />
        </div>
      </div>

      {/* ============================================================
          BOTTOM QUICK-SELECT 6-ZONE ANATOMICAL MATRIX
         ============================================================ */}
      <div className="border-t border-hud-line p-2 sm:p-3 min-w-0">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2 min-w-0" role="group" aria-label="Body zones">
          {ZONE_ORDER.map((zoneId) => {
            const zone = BODY_ZONES[zoneId];
            const status = zoneStatuses[zoneId];
            const color = STATUS_COLORS[status];
            const isSelected = selectedZone === zoneId;

            return (
              <button
                key={zoneId}
                type="button"
                onClick={() => {
                  setSelectedZone(zoneId);
                  if (zoneId === 'neuro' || zoneId === 'behavioral') {
                    setCameraPreset('cranial_sans');
                  } else if (zoneId === 'cardio' || zoneId === 'metabolic') {
                    setCameraPreset('thorax_core');
                  } else {
                    setCameraPreset('full_body');
                  }
                }}
                aria-pressed={isSelected}
                aria-label={`${ZONE_SHORT_NAME[zoneId]}: ${STATUS_WORD[status]}`}
                className={`hud-focus hud-tile flex min-h-[44px] flex-col items-center justify-center p-1.5 sm:p-2 text-center min-w-0 ${isSelected ? 'hud-tile-selected' : ''}`}
              >
                <div className="flex items-center gap-1 sm:gap-1.5 mb-0.5 sm:mb-1">
                  <span style={{ color }}>{ZONE_ICONS[zoneId]}</span>
                  <span style={{ color }}>
                    <StatusIcon status={status} className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                  </span>
                </div>
                <span className="w-full truncate text-[10px] sm:text-[11px] font-medium leading-tight text-hud-text" title={zone.name}>
                  {ZONE_SHORT_NAME[zoneId]}
                </span>
                <span className="mt-0.5 text-[9px] sm:text-[10px] font-medium" style={{ color }}>
                  {STATUS_WORD[status]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
