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
 * - 5 clickable 3D anatomical regions (`neuro`, `cardio`, `musculo`, `immune`, `behavioral`)
 *   dynamically colored by deterministic `TriageStatus` (`#22c55e`, `#eab308`, `#ef4444`).
 */

import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  Activity,
  Bone,
  Brain,
  Crosshair,
  Eye,
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
import {
  createAppendicularSkeletonGeometries,
  createLymphaticConduitGeometries,
  createNeuroVascularGeometries,
  createPelvicGirdleGeometries,
  createSculptedArmGeometry,
  createSculptedHeadAndNeckGeometry,
  createSculptedLegGeometry,
  createSculptedTorsoGeometry,
  createThoracicRibGeometries,
  createVascularTreeGeometries,
} from '../utils/anatomicalGeometry';

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

const LAYER_OPTIONS: { id: AnatomicalLayer; label: string; shortLabel: string }[] = [
  { id: 'all', label: 'All Composite Layers', shortLabel: 'All Layers' },
  { id: 'dermal', label: 'Sculpted Dermal & Muscular Surface', shortLabel: 'Dermal / Muscle' },
  { id: 'skeletal', label: 'Skeletal & Musculoskeletal System', shortLabel: 'Skeletal' },
  { id: 'organs', label: 'Internal Organs & Vascular Network', shortLabel: 'Organs / Vascular' },
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

interface HolographicHumanProps {
  sex: BiologicalSex;
  selectedZone: BodyZoneId;
  hoveredZone: BodyZoneId | null;
  onSelectZone: (zone: BodyZoneId) => void;
  onHoverZone: (zone: BodyZoneId | null) => void;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  anatomicalLayer: AnatomicalLayer;
  showScannerBeam: boolean;
}

const HolographicHumanModel: React.FC<HolographicHumanProps> = ({
  sex,
  selectedZone,
  hoveredZone,
  onSelectZone,
  onHoverZone,
  zoneStatuses,
  anatomicalLayer,
  showScannerBeam,
}) => {
  const isFemale = sex === 'female';
  const pulseGroupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Group>(null);
  const heartRef = useRef<THREE.Group>(null);
  const lungsRef = useRef<THREE.Group>(null);
  const scanRingRef = useRef<THREE.Group>(null);

  // Memoize sculpted 3D anatomical geometries per biological sex
  const anatomies = useMemo(() => {
    const headAndNeck = createSculptedHeadAndNeckGeometry(sex);
    const torso = createSculptedTorsoGeometry(sex);
    const leftArm = createSculptedArmGeometry(sex, -1);
    const rightArm = createSculptedArmGeometry(sex, 1);
    const leftLeg = createSculptedLegGeometry(sex, -1);
    const rightLeg = createSculptedLegGeometry(sex, 1);
    const ribs = createThoracicRibGeometries(sex);
    const pelvis = createPelvicGirdleGeometries(sex);
    const limbBones = createAppendicularSkeletonGeometries(sex);
    const vascularTree = createVascularTreeGeometries(sex);
    const neuroVascular = createNeuroVascularGeometries();
    const lymphaticConduits = createLymphaticConduitGeometries(sex);

    return {
      headAndNeck,
      torso,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      ribs,
      pelvis,
      limbBones,
      vascularTree,
      neuroVascular,
      lymphaticConduits,
    };
  }, [sex]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.55;
      haloRef.current.rotation.x = Math.sin(t * 0.65) * 0.22;
    }
    if (pulseGroupRef.current) {
      // Subtle respiration vertical micro-motion
      pulseGroupRef.current.position.y = -0.02 + Math.sin(t * 1.8) * 0.015;
    }
    if (heartRef.current) {
      // Realistic double-beat systolic/diastolic cardiac contraction
      const beatPhase = (t * 1.15) % 1;
      const d1 = (beatPhase - 0.15) / 0.06;
      const d2 = (beatPhase - 0.32) / 0.08;
      const systole =
        Math.exp(-(d1 * d1)) * 0.11 + Math.exp(-(d2 * d2)) * 0.06;
      const s = 1 + systole;
      heartRef.current.scale.set(s, s, s);
    }
    if (lungsRef.current) {
      // Gentle respiratory lung expansion
      const breath = 1 + Math.sin(t * 1.8) * 0.035;
      lungsRef.current.scale.set(breath, 1 + Math.sin(t * 1.8) * 0.02, breath);
    }
    if (scanRingRef.current && showScannerBeam) {
      // Smooth vertical biometric scanner sweep from feet (-1.92) to crown (+1.92)
      scanRingRef.current.position.y = Math.sin(t * 0.85) * 1.88;
    }
  });

  const showDermal = anatomicalLayer === 'all' || anatomicalLayer === 'dermal';
  const showSkeletal =
    anatomicalLayer === 'all' || anatomicalLayer === 'skeletal';
  const showOrgans = anatomicalLayer === 'all' || anatomicalLayer === 'organs';

  const getZoneMaterialProps = (
    zone: BodyZoneId,
    baseOpacity: number = 0.82
  ) => {
    const status = zoneStatuses[zone];
    const color = STATUS_COLORS[status];
    const isSelected = selectedZone === zone;
    const isHovered = hoveredZone === zone;
    const emissiveIntensity =
      status === 'red'
        ? 1.1
        : isSelected
        ? 0.85
        : isHovered
        ? 0.72
        : 0.38;

    return {
      color,
      emissive: color,
      emissiveIntensity,
      transparent: true,
      opacity:
        isSelected || isHovered ? Math.min(1, baseOpacity + 0.18) : baseOpacity,
      roughness: 0.25,
      metalness: 0.25,
    };
  };

  // Material helper for the outer sculpted dermal/muscular envelope so it looks like a
  // high-resolution medical hologram with specular anatomical shading (never a flat wireframe stickman)
  const getSculptedSkinMaterialProps = (zone: BodyZoneId, isCoreTorso: boolean = false) => {
    const status = zoneStatuses[zone];
    const isAlert = status !== 'green';
    const isSelected = selectedZone === zone;
    const isHovered = hoveredZone === zone;
    const isDermalIsolated = anatomicalLayer === 'dermal';

    const baseColor = isAlert
      ? STATUS_COLORS[status]
      : isSelected || isHovered
      ? '#38bdf8'
      : isFemale
      ? '#22d3ee'
      : '#38bdf8';

    const emissiveColor = isAlert
      ? STATUS_COLORS[status]
      : '#0284c7';

    const opacity = isDermalIsolated
      ? isCoreTorso
        ? 0.88
        : 0.86
      : isAlert
      ? 0.52
      : isSelected || isHovered
      ? 0.5
      : 0.42;

    return {
      color: baseColor,
      emissive: emissiveColor,
      emissiveIntensity: isAlert ? 0.5 : isSelected || isHovered ? 0.38 : 0.22,
      transparent: true,
      opacity,
      roughness: 0.22,
      metalness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.18,
      depthWrite: isDermalIsolated,
      side: THREE.DoubleSide,
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

  // 18-segment curved vertebral column (cervical, thoracic, lumbar, sacral)
  const spineVertebrae = useMemo(() => {
    const items: Array<{ y: number; z: number; rx: number }> = [];
    for (let i = 0; i < 18; i++) {
      const t = i / 17; // 0 = C2 (y=1.36) down to 1 = Sacrum (y=-0.12)
      const y = 1.36 - t * 1.48;
      // Anatomical S-curve in Z
      const z =
        -0.065 +
        Math.sin(t * Math.PI * 2.1) * 0.018 -
        (t > 0.82 ? (t - 0.82) * 0.12 : 0);
      const rx = 0.026 + t * 0.018;
      items.push({ y, z, rx });
    }
    return items;
  }, []);

  const activeTooltipZone = hoveredZone || selectedZone;
  const tooltipAnchor: Record<BodyZoneId, [number, number, number]> = {
    neuro: [0.36, 1.72, 0.15],
    behavioral: [-0.46, 1.88, 0.1],
    cardio: [0.38, 0.82, 0.22],
    immune: [-0.44, 0.52, 0.2],
    musculo: [0.38, -0.62, 0.2],
  };

  return (
    <group ref={pulseGroupRef} position={[0, -0.02, 0]}>
      {/* ============================================================
          HOLOGRAPHIC MEDICAL BAY PEDESTAL & SCANNER STAGE
         ============================================================ */}
      <group position={[0, -1.98, 0]}>
        {/* Outer Calibration Ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.82, 0.96, 64]} />
          <meshBasicMaterial
            color="#22d3ee"
            transparent
            opacity={0.38}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Inner Segmented Ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[0.52, 0.56, 48]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.45}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Glowing Platform Disc */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[0.8, 64]} />
          <meshBasicMaterial
            color="#083344"
            transparent
            opacity={0.36}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Active Biometric Horizontal Laser Scanner Ring */}
      {showScannerBeam && (
        <group ref={scanRingRef} position={[0, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.58, 0.62, 64]} />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.58, 48]} />
            <meshBasicMaterial
              color="#22d3ee"
              transparent
              opacity={0.07}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {/* ============================================================
          LAYER 1: SCULPTED MALE / FEMALE ANATOMICAL BODY ENVELOPE
         ============================================================ */}
      {showDermal && (
        <group>
          {/* 1A. Sculpted Cranium, Face (Brow, Orbit Sockets, Nose, Jaw/Chin) & Neck */}
          <mesh
            geometry={anatomies.headAndNeck}
            {...bindZoneEvents('neuro')}
          >
            <meshPhysicalMaterial {...getSculptedSkinMaterialProps('neuro')} />
          </mesh>
          {/* Subtle holographic contour lattice over head/neck */}
          <mesh geometry={anatomies.headAndNeck}>
            <meshBasicMaterial
              color="#38bdf8"
              wireframe
              transparent
              opacity={0.045}
              depthWrite={false}
            />
          </mesh>

          {/* 1B. Sculpted Torso, Chest (Female Mammary Contours vs Male Pectoralis/Abs), Waist, Pelvis & Glutes */}
          <mesh
            geometry={anatomies.torso}
            {...bindZoneEvents('immune')}
          >
            <meshPhysicalMaterial
              {...getSculptedSkinMaterialProps('immune', true)}
            />
          </mesh>
          {/* Subtle holographic contour lattice over torso */}
          <mesh geometry={anatomies.torso}>
            <meshBasicMaterial
              color={
                zoneStatuses.immune !== 'green'
                  ? STATUS_COLORS[zoneStatuses.immune]
                  : '#22d3ee'
              }
              wireframe
              transparent
              opacity={0.055}
              depthWrite={false}
            />
          </mesh>

          {/* 1C. Sculpted Left & Right Upper Limbs (Deltoid, Biceps/Triceps, Forearm, Wrist & Hand) */}
          <mesh
            geometry={anatomies.leftArm}
            {...bindZoneEvents('immune')}
          >
            <meshPhysicalMaterial {...getSculptedSkinMaterialProps('immune')} />
          </mesh>
          <mesh
            geometry={anatomies.rightArm}
            {...bindZoneEvents('immune')}
          >
            <meshPhysicalMaterial {...getSculptedSkinMaterialProps('immune')} />
          </mesh>

          {/* 1D. Sculpted Left & Right Lower Limbs (Hip/Thigh, Q-Angle, Quadriceps, Patella, Calf, Ankle & Foot) */}
          <mesh
            geometry={anatomies.leftLeg}
            {...bindZoneEvents('musculo')}
          >
            <meshPhysicalMaterial {...getSculptedSkinMaterialProps('musculo')} />
          </mesh>
          <mesh
            geometry={anatomies.rightLeg}
            {...bindZoneEvents('musculo')}
          >
            <meshPhysicalMaterial {...getSculptedSkinMaterialProps('musculo')} />
          </mesh>
          <mesh geometry={anatomies.leftLeg}>
            <meshBasicMaterial
              color="#38bdf8"
              wireframe
              transparent
              opacity={0.04}
              depthWrite={false}
            />
          </mesh>
          <mesh geometry={anatomies.rightLeg}>
            <meshBasicMaterial
              color="#38bdf8"
              wireframe
              transparent
              opacity={0.04}
              depthWrite={false}
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
        <mesh rotation={[Math.PI / 2.3, 0, 0]}>
          <torusGeometry args={[0.36, 0.014, 16, 64]} />
          <meshStandardMaterial {...getZoneMaterialProps('behavioral', 0.92)} />
        </mesh>
        <mesh rotation={[-Math.PI / 3.1, 0.42, 0]}>
          <torusGeometry args={[0.42, 0.01, 16, 64]} />
          <meshStandardMaterial {...getZoneMaterialProps('behavioral', 0.68)} />
        </mesh>
      </group>

      {/* ============================================================
          ZONE 1: NEURO-OCULAR (GYRI BRAIN HEMISPHERES, CEREBELLUM, EYES & OPTIC NERVES)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('neuro')}>
          {/* Left & Right Gyri-Sculpted Cerebral Hemispheres */}
          <mesh position={[-0.068, 1.74, -0.01]} scale={[0.82, 0.95, 1.18]}>
            <icosahedronGeometry args={[0.135, 3]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.9)} />
          </mesh>
          <mesh position={[0.068, 1.74, -0.01]} scale={[0.82, 0.95, 1.18]}>
            <icosahedronGeometry args={[0.135, 3]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.9)} />
          </mesh>

          {/* Cerebellum & Brainstem */}
          <mesh position={[0, 1.61, -0.095]} scale={[1.15, 0.75, 0.85]}>
            <sphereGeometry args={[0.075, 18, 18]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.85)} />
          </mesh>
          <mesh position={[0, 1.48, -0.04]} rotation={[0.12, 0, 0]}>
            <cylinderGeometry args={[0.026, 0.018, 0.22, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.85)} />
          </mesh>

          {/* Bilateral Ocular Globes (Eyes) + Cornea/Iris Rings in Facial Eye Sockets */}
          {([-1, 1] as const).map((side) => (
            <group key={side} position={[side * 0.068, 1.64, 0.145]}>
              <mesh>
                <sphereGeometry args={[0.032, 20, 20]} />
                <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.98)} />
              </mesh>
              {/* Luminous Cornea / Iris Ring */}
              <mesh position={[0, 0, 0.028]}>
                <ringGeometry args={[0.008, 0.018, 20]} />
                <meshBasicMaterial
                  color="#e0f2fe"
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* Optic Nerve Sheath (ONSD — Primary SANS Target) */}
              <mesh
                position={[-side * 0.018, 0, -0.055]}
                rotation={[Math.PI / 2, 0, side * 0.26]}
              >
                <cylinderGeometry args={[0.014, 0.018, 0.11, 14]} />
                <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.96)} />
              </mesh>
            </group>
          ))}

          {/* Carotid / Jugular Neuro-Vascular Tracts */}
          {anatomies.neuroVascular.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.82)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ============================================================
          ZONE 2: CARDIOVASCULAR & PULMONARY (BEATING HEART, LUNGS, BRONCHI, VASCULAR TREE)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('cardio')}>
          {/* Beating 4-Chambered Heart (Myocardium) angled anatomically toward left thorax */}
          <group
            ref={heartRef}
            position={[0.045, 0.76, 0.065]}
            rotation={[0.15, 0, -0.32]}
          >
            {/* Left & Right Ventricles */}
            <mesh position={[0, -0.02, 0]} scale={[0.88, 1.22, 0.85]}>
              <sphereGeometry args={[0.082, 24, 24]} />
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.96)} />
            </mesh>
            {/* Left & Right Atria */}
            <mesh position={[-0.025, 0.055, -0.01]} scale={[1.1, 0.8, 0.9]}>
              <sphereGeometry args={[0.062, 20, 20]} />
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.92)} />
            </mesh>
          </group>

          {/* Trachea & Primary Bronchi */}
          <mesh position={[0, 1.08, 0.02]}>
            <cylinderGeometry args={[0.018, 0.018, 0.28, 14]} />
            <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.78)} />
          </mesh>

          {/* Breathing Left (2-Lobe) & Right (3-Lobe) Sculpted Lungs */}
          <group ref={lungsRef}>
            {/* Right Lung (anatomical right = viewer left, x < 0) */}
            <group position={[-0.135, 0.81, 0.015]}>
              <mesh position={[0, 0.07, 0]} scale={[0.78, 1.05, 0.82]}>
                <sphereGeometry args={[0.115, 24, 24]} />
                <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.52)} />
              </mesh>
              <mesh position={[-0.01, -0.06, 0.01]} scale={[0.88, 0.95, 0.86]}>
                <sphereGeometry args={[0.122, 24, 24]} />
                <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.52)} />
              </mesh>
            </group>

            {/* Left Lung (anatomical left = viewer right, x > 0, with cardiac notch) */}
            <group position={[0.14, 0.81, 0.015]}>
              <mesh position={[0, 0.07, 0]} scale={[0.74, 1.05, 0.8]}>
                <sphereGeometry args={[0.11, 24, 24]} />
                <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.52)} />
              </mesh>
              <mesh position={[0.015, -0.06, 0.01]} scale={[0.82, 0.92, 0.84]}>
                <sphereGeometry args={[0.115, 24, 24]} />
                <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.52)} />
              </mesh>
            </group>
          </group>

          {/* 3D Arterial / Venous Vascular Tree (Aortic Arch, Descending Aorta, Iliac/Femoral & Subclavian Vessels) */}
          {anatomies.vascularTree.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.88)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ============================================================
          ZONE 4: IMMUNE, RADIATION & LYMPHATIC NETWORK (THYMUS, SPLEEN, LIVER, NODES & CONDUITS)
         ============================================================ */}
      {showOrgans && (
        <group {...bindZoneEvents('immune')}>
          {/* Mediastinal Thymus Gland (Bilobed) */}
          <mesh position={[0, 1.02, 0.085]} scale={[1.1, 1.3, 0.65]}>
            <octahedronGeometry args={[0.055, 2]} />
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.94)} />
          </mesh>

          {/* Spleen (Left Upper Quadrant) */}
          <mesh
            position={[isFemale ? 0.19 : 0.23, 0.46, 0.01]}
            rotation={[0, 0, -0.35]}
            scale={[0.75, 1.25, 0.85]}
          >
            <sphereGeometry args={[0.072, 20, 20]} />
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.92)} />
          </mesh>

          {/* Visceral Hepatic / Liver Contour (Right Upper Quadrant, translucent reference) */}
          <mesh
            position={[-0.08, 0.48, 0.04]}
            rotation={[0, 0, 0.22]}
            scale={[1.35, 0.82, 0.85]}
          >
            <sphereGeometry args={[0.11, 20, 20]} />
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.42)} />
          </mesh>

          {/* Interconnected Lymphatic Conduits */}
          {anatomies.lymphaticConduits.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...getZoneMaterialProps('immune', 0.85)} />
            </mesh>
          ))}

          {/* Cervical, Axillary, Cisterna Chyli & Inguinal Lymph Nodes */}
          {[
            [-0.06, 1.32, 0.04],
            [0.06, 1.32, 0.04],
            [isFemale ? -0.27 : -0.34, 0.92, 0.04],
            [isFemale ? 0.27 : 0.34, 0.92, 0.04],
            [0.0, 0.32, 0.05],
            [isFemale ? -0.16 : -0.14, -0.15, 0.08],
            [isFemale ? 0.16 : 0.14, -0.15, 0.08],
          ].map((pos, idx) => (
            <mesh key={idx} position={pos as [number, number, number]}>
              <sphereGeometry args={[0.032, 14, 14]} />
              <meshStandardMaterial {...getZoneMaterialProps('immune', 0.95)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ============================================================
          ZONE 3: SEX-DIMORPHIC SKELETAL & MUSCULOSKELETAL SYSTEM
         ============================================================ */}
      {showSkeletal && (
        <group {...bindZoneEvents('musculo')}>
          {/* 18-Segment Curved Vertebral Column + Spinous Processes */}
          {spineVertebrae.map((v, idx) => (
            <mesh key={idx} position={[0, v.y, v.z]}>
              <cylinderGeometry args={[v.rx, v.rx * 1.04, 0.062, 16]} />
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.92)} />
            </mesh>
          ))}

          {/* Anterior Sternum (Manubrium, Body & Xiphoid Process) */}
          <mesh
            position={[0, 0.84, isFemale ? 0.145 : 0.182]}
            rotation={[0.12, 0, 0]}
            scale={[1, 1, 0.35]}
          >
            <capsuleGeometry args={[0.032, 0.34, 8, 16]} />
            <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.9)} />
          </mesh>

          {/* 10 Pairs of 3D Curved Thoracic Ribs */}
          {anatomies.ribs.map((ribGeo, idx) => (
            <mesh key={idx} geometry={ribGeo}>
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.76)} />
            </mesh>
          ))}

          {/* Sex-Differentiated Pelvic Girdle (Iliac Wings, Acetabulum, Pubic Symphysis & Ischial Rings) */}
          {anatomies.pelvis.map((pelvisGeo, idx) => (
            <mesh key={idx} geometry={pelvisGeo}>
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.9)} />
            </mesh>
          ))}

          {/* Appendicular Skeleton (Clavicles, Humeri, Radius/Ulna, Femoral Necks, Femurs, Tibia/Fibula) */}
          {anatomies.limbBones.map((boneGeo, idx) => (
            <mesh key={idx} geometry={boneGeo}>
              <meshStandardMaterial {...getZoneMaterialProps('musculo', 0.92)} />
            </mesh>
          ))}

          {/* Shoulder Humeral Heads, Elbow Condyles, Femoral Heads & Patella Knee Caps */}
          {([-1, 1] as const).map((side) => {
            const shX = side * (isFemale ? 0.355 : 0.45);
            const elbX = side * (isFemale ? 0.465 : 0.575);
            const acetX = side * (isFemale ? 0.185 : 0.155);
            const kneeX = side * (isFemale ? 0.152 : 0.17);
            return (
              <group key={side}>
                {/* Humeral Head */}
                <mesh position={[shX, 1.04, -0.01]}>
                  <sphereGeometry args={[isFemale ? 0.034 : 0.042, 16, 16]} />
                  <meshStandardMaterial
                    {...getZoneMaterialProps('musculo', 0.92)}
                  />
                </mesh>
                {/* Elbow Joint */}
                <mesh position={[elbX, 0.48, -0.032]}>
                  <sphereGeometry args={[isFemale ? 0.028 : 0.034, 14, 14]} />
                  <meshStandardMaterial
                    {...getZoneMaterialProps('musculo', 0.9)}
                  />
                </mesh>
                {/* Femoral Head in Acetabulum */}
                <mesh position={[acetX, -0.16, 0.02]}>
                  <sphereGeometry args={[0.038, 16, 16]} />
                  <meshStandardMaterial
                    {...getZoneMaterialProps('musculo', 0.96)}
                  />
                </mesh>
                {/* Patella / Knee Joint */}
                <mesh position={[kneeX, -1.0, 0.022]}>
                  <sphereGeometry args={[isFemale ? 0.036 : 0.042, 16, 16]} />
                  <meshStandardMaterial
                    {...getZoneMaterialProps('musculo', 0.94)}
                  />
                </mesh>
              </group>
            );
          })}
        </group>
      )}

      {/* ============================================================
          FLOATING 3D SPATIAL HUD CALLOUT FOR HOVERED / SELECTED ZONE
         ============================================================ */}
      <Html
        position={tooltipAnchor[activeTooltipZone]}
        center
        distanceFactor={5.5}
        zIndexRange={[10, 0]}
      >
        <div className="pointer-events-none select-none px-2.5 py-1 rounded-md bg-slate-950/90 border border-cyan-400/60 shadow-[0_0_18px_rgba(34,211,238,0.3)] whitespace-nowrap flex items-center gap-2">
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
    updateCrewMemberSex,
    setCrewModalOpen,
    selectedZone,
    setSelectedZone,
    setSelectedMetricId,
    zoneStatuses,
    currentZoneReadings,
    environment,
    readinessScore,
    anatomicalLayer,
    setAnatomicalLayer,
  } = useMission();

  const [hoveredZone, setHoveredZone] = useState<BodyZoneId | null>(null);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
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

  const activeZoneId = hoveredZone || selectedZone;
  const activeZoneMeta = BODY_ZONES[activeZoneId];
  const activeZoneStatus = zoneStatuses[activeZoneId];

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
      className="flex flex-col h-full bg-slate-900/75 border border-cyan-400/35 rounded-2xl overflow-hidden shadow-[0_0_45px_rgba(8,145,178,0.18)]"
    >
      {/* ============================================================
          TOP HERO STAGE HEADER: CREW IDENTITY + SEX ANATOMY SWITCHER + VIEW CONTROLS
         ============================================================ */}
      <div className="px-4 py-2.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2 bg-slate-950/85">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-xs md:text-sm font-bold uppercase tracking-wider text-slate-100">
                3D BIO-TWIN STAGE <span className="text-cyan-400">//</span>{' '}
                {activeCrewMember.callsign}
              </h2>
              <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 font-mono text-[10px] font-bold text-cyan-300 uppercase">
                {activeSex === 'female' ? '♀ Female Anatomy' : '♂ Male Anatomy'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {activeCrewMember.name} • {activeCrewMember.role} • Age{' '}
              {activeCrewMember.age} • Blood {activeCrewMember.bloodType} • Sol{' '}
              {activeCrewMember.missionDaysLogged}
            </p>
          </div>
        </div>

        {/* Right Controls: Direct Female/Male Anatomy Toggle + Crew Modal + Auto-Rotate + Reset */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Instant Female / Male 3D Anatomy Morphology Switcher */}
          <div
            className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-700/90"
            role="group"
            aria-label="3D Bio-Twin Biological Sex Anatomy Switcher"
          >
            {(['female', 'male'] as const).map((sexOpt) => {
              const isSelectedSex = activeSex === sexOpt;
              return (
                <button
                  key={sexOpt}
                  type="button"
                  onClick={() =>
                    updateCrewMemberSex(activeCrewMember.id, sexOpt)
                  }
                  title={`Render ${
                    sexOpt === 'female' ? 'Female' : 'Male'
                  } 3D Anatomical Morphology`}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold uppercase transition-all ${
                    isSelectedSex
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/60 shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {sexOpt === 'female' ? '♀ Female' : '♂ Male'}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCrewModalOpen(true)}
            title="Switch Crew Member or Create Custom Astronaut"
            className="px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>ROSTER</span>
          </button>

          <button
            type="button"
            onClick={() => setShowScannerBeam((prev) => !prev)}
            title="Toggle Biometric Laser Scanner Sweep"
            className={`p-1.5 rounded-lg border transition-colors ${
              showScannerBeam
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setAutoRotate((prev) => !prev)}
            title={autoRotate ? 'Pause 3D Rotation' : 'Resume 3D Rotation'}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1 border transition-colors ${
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
            className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/40 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ============================================================
          SECONDARY BAR: ANATOMICAL LAYER SWITCHER + CAMERA FOCUS PRESETS
         ============================================================ */}
      <div className="px-4 py-2 bg-slate-950/65 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
        {/* Layer Switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1 mr-1">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Layer:
          </span>
          {LAYER_OPTIONS.map((layer) => {
            const active = anatomicalLayer === layer.id;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setAnatomicalLayer(layer.id)}
                title={layer.label}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition-all ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.18)]'
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {layer.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Camera Focus Presets */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1 mr-1">
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            Focus:
          </span>
          {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((presetKey) => {
            const active = cameraPreset === presetKey;
            return (
              <button
                key={presetKey}
                type="button"
                onClick={() => setCameraPreset(presetKey)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono uppercase transition-all ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50'
                    : 'bg-slate-900/70 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
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
        className="relative flex-1 min-h-[500px] lg:min-h-[560px] w-full bg-[radial-gradient(ellipse_at_center,_rgba(8,51,68,0.42)_0%,_rgba(2,6,23,0.96)_72%)]"
        onMouseEnter={() => setIsInteracting(true)}
        onMouseLeave={() => {
          setIsInteracting(false);
          setHoveredZone(null);
        }}
      >
        {/* Spacecraft HUD Corner Reticles */}
        <div className="pointer-events-none absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-cyan-400/50" />
        <div className="pointer-events-none absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-cyan-400/50" />

        {/* Left Floating HUD Overlay: Astronaut Anthropometrics & Baselines */}
        <div className="pointer-events-none hidden sm:flex flex-col gap-1.5 absolute top-3.5 left-4 z-10 w-52 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 backdrop-blur-md">
          <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold flex items-center justify-between">
            <span>BIO-TWIN MORPHOLOGY</span>
            <span>{activeSex === 'female' ? 'XX // ♀' : 'XY // ♂'}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-300 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-slate-400">Pelvic / Rib Dimorphism:</span>
              <span className="text-cyan-300 font-semibold uppercase">
                {activeSex}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">HR Baseline:</span>
              <span className="text-slate-100 font-semibold">
                {activeCrewMember.restingHrBaselineBpm} bpm
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pre-Flight ONSD:</span>
              <span className="text-slate-100 font-semibold">
                {activeCrewMember.preFlightOnsdMm} mm
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Readiness Index:</span>
              <span className="text-emerald-400 font-bold">
                {readinessScore}%
              </span>
            </div>
          </div>
        </div>

        {/* Right Floating HUD Overlay: Selected Zone Live Vitals Callout */}
        <div className="hidden sm:flex flex-col gap-1.5 absolute top-3.5 right-4 z-10 w-56 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 backdrop-blur-md">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold truncate">
              {activeZoneMeta.shortLabel} VITALS
            </span>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase"
              style={{
                backgroundColor: `${STATUS_COLORS[activeZoneStatus]}20`,
                color: STATUS_COLORS[activeZoneStatus],
              }}
            >
              {activeZoneStatus}
            </span>
          </div>
          <div className="space-y-1">
            {currentZoneReadings.map((reading) => {
              const mStatus = evaluateMetricStatus(
                reading.metricId,
                reading.currentValue,
                environment
              );
              const mColor = STATUS_COLORS[mStatus];
              return (
                <button
                  key={reading.metricId}
                  type="button"
                  onClick={() => setSelectedMetricId(reading.metricId)}
                  className="w-full text-left px-2 py-1 rounded bg-slate-900/90 hover:bg-slate-800 border border-slate-800 flex items-center justify-between text-[11px] font-mono transition-colors"
                >
                  <span className="text-slate-300 truncate pr-1">
                    {reading.label}
                  </span>
                  <span className="font-bold shrink-0" style={{ color: mColor }}>
                    {reading.currentValue} {reading.unit}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <WebGLErrorBoundary fallback={fallback2DBioMap}>
          <Canvas
            camera={{ position: [0, 0.05, 4.35], fov: 42 }}
            gl={{ antialias: true, alpha: true }}
          >
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

            <HolographicHumanModel
              sex={activeSex}
              selectedZone={selectedZone}
              hoveredZone={hoveredZone}
              onSelectZone={setSelectedZone}
              onHoverZone={setHoveredZone}
              zoneStatuses={zoneStatuses}
              anatomicalLayer={anatomicalLayer}
              showScannerBeam={showScannerBeam}
            />

            <OrbitControls
              ref={controlsRef}
              autoRotate={autoRotate && !isInteracting && !hoveredZone}
              autoRotateSpeed={1.25}
              enablePan={false}
              minDistance={1.5}
              maxDistance={6.2}
              minPolarAngle={Math.PI / 6}
              maxPolarAngle={(5 * Math.PI) / 6}
            />
          </Canvas>
        </WebGLErrorBoundary>

        {/* Bottom Overlay: Active Zone Inspection Readout */}
        <div className="pointer-events-none absolute bottom-3 inset-x-4 px-3.5 py-2 rounded-xl bg-slate-950/85 border border-slate-800/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                {activeZoneMeta.name}
              </span>
              <span className="text-[11px] font-mono text-slate-400 hidden md:inline">
                — {activeZoneMeta.anatomicalSubtitle}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
              {activeCrewMember.medicalNotes}
            </p>
          </div>

          <span
            className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase shrink-0"
            style={{
              backgroundColor: `${STATUS_COLORS[activeZoneStatus]}20`,
              color: STATUS_COLORS[activeZoneStatus],
              border: `1px solid ${STATUS_COLORS[activeZoneStatus]}55`,
            }}
          >
            {STATUS_LABELS[activeZoneStatus]}
          </span>
        </div>
      </div>

      {/* ============================================================
          BOTTOM QUICK-SELECT 5-ZONE ANATOMICAL MATRIX
         ============================================================ */}
      <div className="p-3 bg-slate-950/90 border-t border-slate-800/90">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
          <span>Anatomical Bio-Zones (5) — Click 3D Body or Zone Card</span>
          <span className="text-cyan-400/90">
            Drag to rotate 360° • Scroll to zoom
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
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
                  } else if (zoneId === 'cardio') {
                    setCameraPreset('thorax_core');
                  } else {
                    setCameraPreset('full_body');
                  }
                }}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all ${
                  isSelected
                    ? 'bg-slate-800/95 border-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.22)]'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status === 'red' ? 'animate-ping' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                  <span style={{ color }}>{ZONE_ICONS[zoneId]}</span>
                </div>
                <span className="font-mono text-[10px] md:text-[11px] font-bold text-slate-200 leading-tight truncate w-full">
                  {zone.shortLabel}
                </span>
                <span
                  className="font-mono text-[9px] uppercase font-semibold mt-0.5"
                  style={{ color }}
                >
                  {STATUS_LABELS[status]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
