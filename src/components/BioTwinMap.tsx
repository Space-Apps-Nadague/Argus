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
import {
  createAirwayGeometries,
  createAppendicularSkeletonGeometries,
  createBrainHemisphereGeometry,
  createCerebellumGeometry,
  createHeartGeometry,
  createLiverGeometry,
  createLungGeometry,
  createLymphaticConduitGeometries,
  createNeuroVascularGeometries,
  createPelvicGirdleGeometries,
  createSculptedArmGeometry,
  createSculptedHeadAndNeckGeometry,
  createSculptedLegGeometry,
  createSculptedTorsoGeometry,
  createSpleenGeometry,
  createThoracicRibGeometries,
  createThymusGeometry,
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
    const leftBrainHemisphere = createBrainHemisphereGeometry(1);
    const rightBrainHemisphere = createBrainHemisphereGeometry(-1);
    const cerebellum = createCerebellumGeometry();
    const heart = createHeartGeometry();
    const rightLung = createLungGeometry(-1, sex);
    const leftLung = createLungGeometry(1, sex);
    const airways = createAirwayGeometries();
    const liver = createLiverGeometry(sex);
    const spleen = createSpleenGeometry();
    const thymus = createThymusGeometry();

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
      leftBrainHemisphere,
      rightBrainHemisphere,
      cerebellum,
      heart,
      rightLung,
      leftLung,
      airways,
      liver,
      spleen,
      thymus,
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
          <mesh
            position={[-0.022, 1.745, -0.01]}
            geometry={anatomies.rightBrainHemisphere}
          >
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.9)} />
          </mesh>
          <mesh
            position={[0.022, 1.745, -0.01]}
            geometry={anatomies.leftBrainHemisphere}
          >
            <meshStandardMaterial {...getZoneMaterialProps('neuro', 0.9)} />
          </mesh>

          {/* Cerebellum & Brainstem */}
          <mesh
            position={[0, 1.615, -0.095]}
            geometry={anatomies.cerebellum}
          >
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
            position={[0.04, 0.75, 0.06]}
            rotation={[0.12, -0.15, -0.22]}
          >
            <mesh geometry={anatomies.heart}>
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.96)} />
            </mesh>
          </group>

          {/* Trachea & Bifurcating Primary Bronchi */}
          {anatomies.airways.map((geo, idx) => (
            <mesh key={`airway-${idx}`} geometry={geo}>
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.78)} />
            </mesh>
          ))}

          {/* Breathing Left (2-Lobe + Cardiac Notch) & Right (3-Lobe) Sculpted Lungs */}
          <group ref={lungsRef}>
            {/* Right Lung (anatomical right = viewer left, x < 0) */}
            <mesh
              position={[isFemale ? -0.115 : -0.145, 0.8, 0.008]}
              geometry={anatomies.rightLung}
            >
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.54)} />
            </mesh>

            {/* Left Lung (anatomical left = viewer right, x > 0, with cardiac notch) */}
            <mesh
              position={[isFemale ? 0.12 : 0.15, 0.8, 0.008]}
              geometry={anatomies.leftLung}
            >
              <meshStandardMaterial {...getZoneMaterialProps('cardio', 0.54)} />
            </mesh>
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
          <mesh position={[0, 1.02, 0.082]} geometry={anatomies.thymus}>
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.94)} />
          </mesh>

          {/* Spleen (Left Upper Quadrant, crescent-shaped) */}
          <mesh
            position={[isFemale ? 0.175 : 0.21, 0.46, 0.005]}
            rotation={[0.08, -0.2, -0.32]}
            geometry={anatomies.spleen}
          >
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.92)} />
          </mesh>

          {/* Visceral Hepatic / Liver Contour (Right Upper Quadrant, asymmetric wedge) */}
          <mesh
            position={[isFemale ? -0.055 : -0.065, 0.49, 0.035]}
            rotation={[0.05, 0, 0.1]}
            geometry={anatomies.liver}
          >
            <meshStandardMaterial {...getZoneMaterialProps('immune', 0.46)} />
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
      className="hud-card flex h-full flex-col overflow-hidden"
    >
      {/* Stage toolbar: anatomy · scanner · rotate · reset (labels in tooltips) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-display text-[13px] font-semibold tracking-wide text-hud-text">
          <Sparkles className="h-4 w-4 text-hud-accent" aria-hidden="true" />
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line/70 px-4 py-2">
        {/* Layer Switcher */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Anatomy layer">
          <Layers className="mr-1 h-4 w-4 text-hud-muted" aria-hidden="true" />
          {LAYER_OPTIONS.map((layer) => {
            const active = anatomicalLayer === layer.id;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setAnatomicalLayer(layer.id)}
                title={layer.label}
                aria-pressed={active}
                className="hud-seg"
              >
                {layer.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Camera Focus Presets */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Camera focus">
          <Crosshair className="mr-1 h-4 w-4 text-hud-muted" aria-hidden="true" />
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
        className="relative flex-1 min-h-[420px] sm:min-h-[500px] lg:min-h-[560px] w-full bg-[radial-gradient(ellipse_at_center,_rgba(8,51,68,0.42)_0%,_rgba(2,6,23,0.96)_72%)]"
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

        {/* Bottom overlay: hovered/selected zone */}
        <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between gap-2 rounded-xl border border-hud-line bg-hud-bg/85 px-3.5 py-2 backdrop-blur-md">
          <span className="flex items-center gap-2 text-sm font-medium text-hud-text">
            <Activity className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            {activeZoneMeta.name}
          </span>
          <StatusPill status={activeZoneStatus} />
        </div>
      </div>

      {/* ============================================================
          BOTTOM QUICK-SELECT 5-ZONE ANATOMICAL MATRIX
         ============================================================ */}
      <div className="border-t border-hud-line p-3">
        <div className="grid grid-cols-5 gap-2" role="group" aria-label="Body zones">
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
                aria-pressed={isSelected}
                aria-label={`${ZONE_SHORT_NAME[zoneId]}: ${STATUS_WORD[status]}`}
                className={`hud-focus hud-tile flex flex-col items-center justify-center p-2 text-center ${isSelected ? 'hud-tile-selected' : ''}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span style={{ color }}>{ZONE_ICONS[zoneId]}</span>
                  <span style={{ color }}>
                    <StatusIcon status={status} className="h-3 w-3" />
                  </span>
                </div>
                <span className="w-full truncate text-[11px] font-medium leading-tight text-hud-text" title={zone.name}>
                  {ZONE_SHORT_NAME[zoneId]}
                </span>
                <span className="mt-0.5 text-[10px] font-medium" style={{ color }}>
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
