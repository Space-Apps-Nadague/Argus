/**
 * ARGUS — Interactive 3D Holographic Anatomical Bio-Twin (`BioTwinMap.tsx`)
 * Single Source of Truth: specs/02-ui-dashboard.md (§1 Left Column — 30%)
 *
 * Features:
 * - Rotating interactive 3D Holographic Human Bio-Twin (`OrbitControls` with auto-rotate
 *   that pauses on hover/drag, zoom, and camera reset).
 * - Anatomical Layer Switcher (`All Layers`, `Dermal / Surface`, `Skeletal / Musculoskeletal`, `Organs / Vascular`).
 * - 5 clickable 3D anatomical regions (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`)
 *   dynamically colored by deterministic `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`)
 *   with hover tooltips and quick-select zone pills.
 */

import React, { Component, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Activity,
  Bone,
  Brain,
  Eye,
  HeartPulse,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import {
  AnatomicalLayer,
  BodyZoneId,
  TriageStatus,
} from '../types/argus';
import { BODY_ZONES, ZONE_ORDER } from '../data/telemetryScenarios';
import { STATUS_COLORS, STATUS_LABELS } from '../utils/triageEngine';

const LAYER_OPTIONS: { id: AnatomicalLayer; label: string; shortLabel: string }[] = [
  { id: 'all', label: 'All Layers', shortLabel: 'All Layers' },
  { id: 'dermal', label: 'Dermal / Surface', shortLabel: 'Dermal' },
  { id: 'skeletal', label: 'Skeletal / Musculoskeletal', shortLabel: 'Skeletal' },
  { id: 'organs', label: 'Organs / Vascular', shortLabel: 'Organs' },
];

const ZONE_ICONS: Record<BodyZoneId, React.ReactNode> = {
  neuro: <Brain className="w-3.5 h-3.5" />,
  cardio: <HeartPulse className="w-3.5 h-3.5" />,
  musculo: <Bone className="w-3.5 h-3.5" />,
  immune: <ShieldAlert className="w-3.5 h-3.5" />,
  behavioral: <Eye className="w-3.5 h-3.5" />,
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

interface HolographicHumanProps {
  selectedZone: BodyZoneId;
  hoveredZone: BodyZoneId | null;
  onSelectZone: (zone: BodyZoneId) => void;
  onHoverZone: (zone: BodyZoneId | null) => void;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  anatomicalLayer: AnatomicalLayer;
}

const HolographicHumanModel: React.FC<HolographicHumanProps> = ({
  selectedZone,
  hoveredZone,
  onSelectZone,
  onHoverZone,
  zoneStatuses,
  anatomicalLayer,
}) => {
  const pulseGroupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.6;
      haloRef.current.rotation.x = Math.sin(t * 0.7) * 0.25;
    }
    if (pulseGroupRef.current) {
      // Subtle breathing motion
      pulseGroupRef.current.position.y = Math.sin(t * 1.6) * 0.03;
    }
  });

  const showDermal = anatomicalLayer === 'all' || anatomicalLayer === 'dermal';
  const showSkeletal =
    anatomicalLayer === 'all' || anatomicalLayer === 'skeletal';
  const showOrgans = anatomicalLayer === 'all' || anatomicalLayer === 'organs';

  const getZoneMaterialProps = (
    zone: BodyZoneId,
    baseOpacity: number = 0.78
  ) => {
    const status = zoneStatuses[zone];
    const color = STATUS_COLORS[status];
    const isSelected = selectedZone === zone;
    const isHovered = hoveredZone === zone;
    const emissiveIntensity =
      status === 'red'
        ? 1.15
        : isSelected
        ? 0.9
        : isHovered
        ? 0.75
        : 0.42;

    return {
      color,
      emissive: color,
      emissiveIntensity,
      transparent: true,
      opacity: isSelected || isHovered ? Math.min(1, baseOpacity + 0.2) : baseOpacity,
      roughness: 0.25,
      metalness: 0.3,
    };
  };

  const bindZoneEvents = (zone: BodyZoneId) => ({
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelectZone(zone);
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHoverZone(zone);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHoverZone(null);
      document.body.style.cursor = 'auto';
    },
  });

  const spineVertebraeY = [
    1.18, 1.02, 0.86, 0.7, 0.54, 0.38, 0.22, 0.06, -0.1,
  ];

  const activeTooltipZone = hoveredZone || selectedZone;
  const tooltipAnchorY: Record<BodyZoneId, [number, number, number]> = {
    neuro: [0, 1.82, 0],
    behavioral: [0.52, 2.02, 0],
    cardio: [0.35, 0.95, 0.25],
    immune: [-0.42, 0.65, 0.2],
    musculo: [0.38, -0.55, 0.2],
  };

  return (
    <group ref={pulseGroupRef} position={[0, -0.15, 0]}>
      {/* Base Holographic Pedestal */}
      <group position={[0, -2.02, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.65, 0.92, 48]} />
          <meshBasicMaterial
            color="#22d3ee"
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <circleGeometry args={[0.62, 48]} />
          <meshBasicMaterial
            color="#083344"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* ============================================================
          LAYER 1: DERMAL / SURFACE HOLOGRAPHIC ENVELOPE & IMMUNE SHELL
         ============================================================ */}
      {showDermal && (
        <group>
          {/* Cranial Outer Shell */}
          <mesh position={[0, 1.66, 0]} {...bindZoneEvents('neuro')}>
            <sphereGeometry args={[0.31, 24, 24]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#0284c7"
              emissiveIntensity={0.2}
              transparent
              opacity={anatomicalLayer === 'dermal' ? 0.38 : 0.14}
              wireframe={anatomicalLayer === 'all'}
            />
          </mesh>

          {/* Neck */}
          <mesh position={[0, 1.28, 0]}>
            <cylinderGeometry args={[0.13, 0.15, 0.24, 16]} />
            <meshStandardMaterial
              color="#38bdf8"
              transparent
              opacity={0.18}
            />
          </mesh>

          {/* Torso Dermal Barrier (Clickable for Immune / Dermal when in Dermal/All mode) */}
          <mesh
            position={[0, 0.56, 0]}
            {...bindZoneEvents('immune')}
          >
            <cylinderGeometry args={[0.42, 0.33, 1.25, 24]} />
            <meshStandardMaterial
              {...getZoneMaterialProps(
                'immune',
                anatomicalLayer === 'dermal' ? 0.55 : 0.16
              )}
              wireframe={anatomicalLayer === 'all'}
            />
          </mesh>

          {/* Left & Right Upper/Lower Arms */}
          <mesh
            position={[-0.58, 0.58, 0]}
            rotation={[0, 0, 0.16]}
            {...bindZoneEvents('immune')}
          >
            <capsuleGeometry args={[0.1, 0.95, 12, 16]} />
            <meshStandardMaterial
              color={STATUS_COLORS[zoneStatuses.immune]}
              emissive={STATUS_COLORS[zoneStatuses.immune]}
              emissiveIntensity={0.25}
              transparent
              opacity={anatomicalLayer === 'dermal' ? 0.5 : 0.18}
            />
          </mesh>
          <mesh
            position={[0.58, 0.58, 0]}
            rotation={[0, 0, -0.16]}
            {...bindZoneEvents('immune')}
          >
            <capsuleGeometry args={[0.1, 0.95, 12, 16]} />
            <meshStandardMaterial
              color={STATUS_COLORS[zoneStatuses.immune]}
              emissive={STATUS_COLORS[zoneStatuses.immune]}
              emissiveIntensity={0.25}
              transparent
              opacity={anatomicalLayer === 'dermal' ? 0.5 : 0.18}
            />
          </mesh>

          {/* Left & Right Legs Dermal Silhouette */}
          <mesh position={[-0.22, -0.95, 0]} {...bindZoneEvents('musculo')}>
            <capsuleGeometry args={[0.13, 1.35, 12, 16]} />
            <meshStandardMaterial
              color="#38bdf8"
              transparent
              opacity={anatomicalLayer === 'dermal' ? 0.42 : 0.13}
            />
          </mesh>
          <mesh position={[0.22, -0.95, 0]} {...bindZoneEvents('musculo')}>
            <capsuleGeometry args={[0.13, 1.35, 12, 16]} />
            <meshStandardMaterial
              color="#38bdf8"
              transparent
              opacity={anatomicalLayer === 'dermal' ? 0.42 : 0.13}
            />
          </mesh>
        </group>
      )}

      {/* ============================================================
          ZONE 5: BEHAVIORAL / CIRCADIAN NEURAL HALO RINGS
         ============================================================ */}
      <group
        ref={haloRef}
        position={[0, 1.72, 0]}
        {...bindZoneEvents('behavioral')}
      >
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.46, 0.022, 16, 64]} />
          <meshStandardMaterial {...getZoneMaterialProps('behavioral', 0.9)} />
        </mesh>
        <mesh rotation={[-Math.PI / 3, 0.4, 0]}>
          <torusGeometry args={[0.53, 0.014, 16, 64]} />
          <meshStandardMaterial {...getZoneMaterialProps('behavioral', 0.65)} />
        </mesh>
      </group>

      {/* ============================================================
          ZONE 1: NEURO-OCULAR (BRAIN HEMISPHERES, OPTIC NERVES & EYES)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('neuro')}>
          {/* Left & Right Cerebral Hemispheres */}
          <mesh position={[-0.08, 1.7, 0]}>
            <sphereGeometry args={[0.19, 24, 24]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.88)} />
          </mesh>
          <mesh position={[0.08, 1.7, 0]}>
            <sphereGeometry args={[0.19, 24, 24]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.88)} />
          </mesh>

          {/* Left & Right Ocular Globes & Optic Nerve Sheaths (SANS Target) */}
          <mesh position={[-0.1, 1.63, 0.25]}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.98)} />
          </mesh>
          <mesh position={[0.1, 1.63, 0.25]}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.98)} />
          </mesh>
          {/* Optic Nerve Tracts */}
          <mesh
            position={[-0.08, 1.63, 0.14]}
            rotation={[Math.PI / 2, 0, -0.15]}
          >
            <cylinderGeometry args={[0.022, 0.026, 0.18, 12]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.95)} />
          </mesh>
          <mesh
            position={[0.08, 1.63, 0.14]}
            rotation={[Math.PI / 2, 0, 0.15]}
          >
            <cylinderGeometry args={[0.022, 0.026, 0.18, 12]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.95)} />
          </mesh>
        </group>
      )}

      {/* ============================================================
          ZONE 2: CARDIOVASCULAR & PULMONARY (HEART, AORTIC ARCH, LUNGS)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('cardio')}>
          {/* Myocardium / Heart Core */}
          <mesh position={[0.06, 0.78, 0.12]}>
            <dodecahedronGeometry args={[0.15, 1]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.95)} />
          </mesh>
          {/* Aortic Arch & Descending Thoracic Aorta */}
          <mesh position={[0.03, 0.96, 0.08]}>
            <torusGeometry args={[0.08, 0.024, 12, 24, Math.PI]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.9)} />
          </mesh>
          <mesh position={[0.02, 0.56, 0.06]}>
            <cylinderGeometry args={[0.028, 0.022, 0.65, 12]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.85)} />
          </mesh>
          {/* Left & Right Pulmonary Lobes */}
          <mesh position={[-0.18, 0.8, 0.04]} scale={[0.85, 1.35, 0.8]}>
            <sphereGeometry args={[0.16, 20, 20]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.48)} />
          </mesh>
          <mesh position={[0.2, 0.8, 0.04]} scale={[0.85, 1.35, 0.8]}>
            <sphereGeometry args={[0.15, 20, 20]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.48)} />
          </mesh>
        </group>
      )}

      {/* ============================================================
          ZONE 4: IMMUNE, RADIATION & LYMPHATIC CORE (THYMUS, SPLEEN, NODES)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('immune')}>
          {/* Mediastinal / Thymic Lymphatic Cluster */}
          <mesh position={[0, 1.08, 0.14]}>
            <octahedronGeometry args={[0.09, 1]} />
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.92)} />
          </mesh>
          {/* Splenic / Abdominal Lymphatic Core */}
          <mesh position={[0.22, 0.42, 0.08]}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.88)} />
          </mesh>
          {/* Axillary & Inguinal Lymph Nodes + Vessels */}
          {[
            [-0.32, 0.92, 0.1],
            [0.32, 0.92, 0.1],
            [-0.18, 0.15, 0.12],
            [0.18, 0.15, 0.12],
          ].map((pos, idx) => (
            <mesh key={idx} position={pos as [number, number, number]}>
              <sphereGeometry args={[0.055, 14, 14]} />
              <meshStandardMaterial {...getZoneMaterialProps('immune', 0.9)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ============================================================
          ZONE 3: MUSCULOSKELETAL & SPINE (VERTEBRAE, RIBS, PELVIS, FEMURS)
         ============================================================ */}
      {showSkeletal && (
        <group {...bindZoneEvents('musculo')}>
          {/* Vertebral Column */}
          {spineVertebraeY.map((y, idx) => (
            <mesh key={idx} position={[0, y, -0.08]}>
              <cylinderGeometry args={[0.065, 0.07, 0.1, 12]} />
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.9)} />
            </mesh>
          ))}

          {/* Thoracic Ribcage Hoops */}
          {[0.96, 0.8, 0.64, 0.48].map((y, idx) => (
            <mesh
              key={idx}
              position={[0, y, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1.15, 0.78, 1]}
            >
              <torusGeometry args={[0.29 - idx * 0.015, 0.018, 10, 32]} />
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.65)} />
            </mesh>
          ))}

          {/* Pelvic Girdle */}
          <mesh
            position={[0, -0.18, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[1.2, 0.8, 1]}
          >
            <torusGeometry args={[0.25, 0.045, 12, 32]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.88)} />
          </mesh>

          {/* Left & Right Femoral Shafts & Femoral Necks (Primary BMD Target) */}
          <mesh position={[-0.22, -0.72, 0]}>
            <cylinderGeometry args={[0.055, 0.042, 0.88, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.95)} />
          </mesh>
          <mesh position={[0.22, -0.72, 0]}>
            <cylinderGeometry args={[0.055, 0.042, 0.88, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.95)} />
          </mesh>

          {/* Knee Joints & Tibia/Fibula */}
          <mesh position={[-0.22, -1.2, 0]}>
            <sphereGeometry args={[0.065, 14, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.9)} />
          </mesh>
          <mesh position={[0.22, -1.2, 0]}>
            <sphereGeometry args={[0.065, 14, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.9)} />
          </mesh>
          <mesh position={[-0.22, -1.58, 0]}>
            <cylinderGeometry args={[0.042, 0.032, 0.72, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.85)} />
          </mesh>
          <mesh position={[0.22, -1.58, 0]}>
            <cylinderGeometry args={[0.042, 0.032, 0.72, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.85)} />
          </mesh>
        </group>
      )}

      {/* ============================================================
          FLOATING 3D HUD CALLOUT FOR HOVERED / SELECTED ZONE
         ============================================================ */}
      <Html
        position={tooltipAnchorY[activeTooltipZone]}
        center
        distanceFactor={6}
        zIndexRange={[10, 0]}
      >
        <div className="pointer-events-none select-none px-2.5 py-1 rounded-md bg-slate-950/90 border border-cyan-400/50 shadow-[0_0_15px_rgba(34,211,238,0.25)] whitespace-nowrap flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              backgroundColor: STATUS_COLORS[zoneStatuses[activeTooltipZone]],
            }}
          />
          <span className="font-mono text-[11px] font-bold text-slate-100">
            {BODY_ZONES[activeTooltipZone].shortLabel}
          </span>
          <span
            className="font-mono text-[10px] font-semibold uppercase"
            style={{ color: STATUS_COLORS[zoneStatuses[activeTooltipZone]] }}
          >
            {STATUS_LABELS[zoneStatuses[activeTooltipZone]]}
          </span>
        </div>
      </Html>
    </group>
  );
};

export const BioTwinMap: React.FC = () => {
  const {
    activeCrewMember,
    setCrewModalOpen,
    selectedZone,
    setSelectedZone,
    zoneStatuses,
    anatomicalLayer,
    setAnatomicalLayer,
  } = useMission();

  const [hoveredZone, setHoveredZone] = useState<BodyZoneId | null>(null);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  const activeZoneMeta = BODY_ZONES[hoveredZone || selectedZone];
  const activeZoneStatus = zoneStatuses[hoveredZone || selectedZone];

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
      aria-label="3D Holographic Human Bio-Twin"
      className="flex flex-col h-full bg-slate-900/60 border border-cyan-500/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(2,6,23,0.8)]"
    >
      {/* Top Panel Header & Camera Controls */}
      <div className="px-3.5 py-2.5 border-b border-slate-800/90 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100">
              3D Bio-Twin // {activeCrewMember.callsign}
            </h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[190px]">
              {activeCrewMember.name} ({activeCrewMember.age}y • {activeCrewMember.bloodType})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCrewModalOpen(true)}
            title="Switch Crew Member or Create Custom Astronaut"
            className="px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 transition-colors"
          >
            <UserCheck className="w-3 h-3" />
            <span>CREW</span>
          </button>
          <button
            type="button"
            onClick={() => setAutoRotate((prev) => !prev)}
            title={autoRotate ? 'Pause 3D Rotation' : 'Resume 3D Rotation'}
            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition-colors ${
              autoRotate
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            {autoRotate ? (
              <Pause className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <span>{autoRotate ? 'ROTATING' : 'PAUSED'}</span>
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            title="Reset 3D Camera View"
            className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active Astronaut Baseline Bar */}
      <div className="px-3.5 py-1.5 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-300">
        <span>
          ROLE: <strong className="text-cyan-300">{activeCrewMember.role}</strong>
        </span>
        <span>
          HR BASE: <strong className="text-cyan-300">{activeCrewMember.restingHrBaselineBpm} bpm</strong> • ONSD:{' '}
          <strong className="text-cyan-300">{activeCrewMember.preFlightOnsdMm} mm</strong>
        </span>
      </div>

      {/* Anatomical Layer Switcher Bar */}
      <div className="px-3 py-2 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between gap-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1 shrink-0">
          <Layers className="w-3 h-3 text-cyan-400" />
          Layer:
        </span>
        <div className="grid grid-cols-4 gap-1 w-full max-w-[310px]">
          {LAYER_OPTIONS.map((layer) => {
            const active = anatomicalLayer === layer.id;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setAnatomicalLayer(layer.id)}
                title={layer.label}
                className={`px-2 py-1 rounded text-[11px] font-mono font-medium truncate transition-all ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                    : 'bg-slate-900/70 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {layer.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3D Interactive Viewport */}
      <div
        className="relative flex-1 min-h-[340px] w-full bg-gradient-to-b from-slate-950 via-slate-900/90 to-slate-950"
        onMouseEnter={() => setIsInteracting(true)}
        onMouseLeave={() => {
          setIsInteracting(false);
          setHoveredZone(null);
        }}
      >
        {/* Subtle HUD Corner Brackets */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 w-4 h-4 border-t-2 border-l-2 border-cyan-400/40" />
        <div className="pointer-events-none absolute top-2.5 right-2.5 w-4 h-4 border-t-2 border-r-2 border-cyan-400/40" />
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 w-4 h-4 border-b-2 border-l-2 border-cyan-400/40" />
        <div className="pointer-events-none absolute bottom-2.5 right-2.5 w-4 h-4 border-b-2 border-r-2 border-cyan-400/40" />

        <WebGLErrorBoundary fallback={fallback2DBioMap}>
          <Canvas
            camera={{ position: [0, 0.2, 4.6], fov: 44 }}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.75} />
            <directionalLight position={[3, 5, 4]} intensity={1.3} />
            <pointLight position={[-3, -2, 3]} intensity={0.8} color="#22d3ee" />

            <HolographicHumanModel
              selectedZone={selectedZone}
              hoveredZone={hoveredZone}
              onSelectZone={setSelectedZone}
              onHoverZone={setHoveredZone}
              zoneStatuses={zoneStatuses}
              anatomicalLayer={anatomicalLayer}
            />

            <OrbitControls
              ref={controlsRef}
              autoRotate={autoRotate && !isInteracting && !hoveredZone}
              autoRotateSpeed={1.35}
              enablePan={false}
              minDistance={2.8}
              maxDistance={6.4}
              minPolarAngle={Math.PI / 6}
              maxPolarAngle={(5 * Math.PI) / 6}
            />
          </Canvas>
        </WebGLErrorBoundary>

        {/* Bottom Overlay: Active Zone Inspection Readout */}
        <div className="pointer-events-none absolute bottom-2.5 inset-x-3 px-3 py-2 rounded-lg bg-slate-950/85 border border-slate-800/90 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              {activeZoneMeta.name}
            </span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
              style={{
                backgroundColor: `${STATUS_COLORS[activeZoneStatus]}20`,
                color: STATUS_COLORS[activeZoneStatus],
                border: `1px solid ${STATUS_COLORS[activeZoneStatus]}55`,
              }}
            >
              {STATUS_LABELS[activeZoneStatus]}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
            {activeZoneMeta.anatomicalSubtitle}
          </p>
        </div>
      </div>

      {/* Bottom Quick-Select 5-Zone Pills */}
      <div className="p-3 bg-slate-950/90 border-t border-slate-800/90">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
          <span>Anatomical Bio-Zones (5)</span>
          <span className="text-cyan-400/80">Click 3D model or pill</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {ZONE_ORDER.map((zoneId) => {
            const zone = BODY_ZONES[zoneId];
            const status = zoneStatuses[zoneId];
            const color = STATUS_COLORS[status];
            const isSelected = selectedZone === zoneId;

            return (
              <button
                key={zoneId}
                type="button"
                onClick={() => setSelectedZone(zoneId)}
                className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                  isSelected
                    ? 'bg-slate-800/95 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status === 'red' ? 'animate-ping' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                  <span style={{ color }}>{ZONE_ICONS[zoneId]}</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-slate-200 leading-tight truncate w-full">
                  {zone.shortLabel.split(' ')[0]}
                </span>
                <span
                  className="font-mono text-[9px] uppercase font-semibold mt-0.5"
                  style={{ color }}
                >
                  {status}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
