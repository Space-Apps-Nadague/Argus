/**
 * ARGUS — organ-by-organ 3D Bio-Twin model.
 * Same sculpted geometry as before, regrouped so every organ is its own click target, coloured by
 * its own status, and shown/hidden by peel level. A marker (DOM button) floats on each visible organ:
 * a red or amber "!" ring when it is off baseline, a small dot otherwise. Markers stay clickable
 * even when the organ sits behind another one.
 */

import React, { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { BiologicalSex } from '../../types/argus';
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
  createPancreasGeometry,
  createPelvicGirdleGeometries,
  createSculptedArmGeometry,
  createSculptedHeadAndNeckGeometry,
  createSculptedLegGeometry,
  createSculptedTorsoGeometry,
  createSpleenGeometry,
  createThoracicRibGeometries,
  createThymusGeometry,
  createVascularTreeGeometries,
} from '../../utils/anatomicalGeometry';
import { STATUS_HEX, statusStyle } from '../thousandEyes/statusColors';
import type { Status } from '../thousandEyes/types';
import { ORGAN_BY_ID, ORGANS, type OrganId, type PeelLevel } from './organs';

const NO_DATA_HEX = '#7d8fa3';
const NEUTRAL_HEX = '#38bdf8';

const hexFor = (s: Status | undefined) =>
  s === 2 ? STATUS_HEX.critical : s === 1 ? STATUS_HEX.warn : s === 0 ? STATUS_HEX.ok : NO_DATA_HEX;

type V3 = [number, number, number];

/** Marker anchor per organ (x mirrored for sex where it matters). */
function anchorFor(id: OrganId, isFemale: boolean): V3 {
  switch (id) {
    case 'brain':
      return [0, 1.9, 0.02];
    case 'eyes':
      return [0.075, 1.645, 0.2];
    case 'heart':
      return [0.07, 0.78, 0.17];
    case 'lungs':
      return [-0.19, 0.93, 0.12];
    case 'liver':
      return [-0.13, 0.47, 0.17];
    case 'spleen':
      return [isFemale ? 0.2 : 0.235, 0.47, 0.1];
    case 'kidneys':
      return [-(isFemale ? 0.09 : 0.1), 0.33, 0.02];
    case 'muscles':
      return [isFemale ? 0.17 : 0.19, -0.5, 0.14];
    case 'bones':
      return [0, -0.12, 0.12];
  }
}

export interface OrganTwinModelProps {
  sex: BiologicalSex;
  peel: PeelLevel;
  organStatus: Record<OrganId, Status | undefined>;
  selectedOrgan: OrganId | null;
  hoveredOrgan: OrganId | null;
  onSelectOrgan: (organ: OrganId) => void;
  onHoverOrgan: (organ: OrganId | null) => void;
  showScannerBeam: boolean;
}

const OrganTwinModelImpl: React.FC<OrganTwinModelProps> = ({
  sex,
  peel,
  organStatus,
  selectedOrgan,
  hoveredOrgan,
  onSelectOrgan,
  onHoverOrgan,
  showScannerBeam,
}) => {
  const isFemale = sex === 'female';
  const pulseGroupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Group>(null);
  const heartRef = useRef<THREE.Group>(null);
  const lungsRef = useRef<THREE.Group>(null);
  const scanRingRef = useRef<THREE.Group>(null);

  const anatomies = useMemo(
    () => ({
      headAndNeck: createSculptedHeadAndNeckGeometry(sex),
      torso: createSculptedTorsoGeometry(sex),
      leftArm: createSculptedArmGeometry(sex, -1),
      rightArm: createSculptedArmGeometry(sex, 1),
      leftLeg: createSculptedLegGeometry(sex, -1),
      rightLeg: createSculptedLegGeometry(sex, 1),
      ribs: createThoracicRibGeometries(sex),
      pelvis: createPelvicGirdleGeometries(sex),
      limbBones: createAppendicularSkeletonGeometries(sex),
      vascularTree: createVascularTreeGeometries(sex),
      neuroVascular: createNeuroVascularGeometries(),
      lymphaticConduits: createLymphaticConduitGeometries(sex),
      leftBrainHemisphere: createBrainHemisphereGeometry(1),
      rightBrainHemisphere: createBrainHemisphereGeometry(-1),
      cerebellum: createCerebellumGeometry(),
      heart: createHeartGeometry(),
      rightLung: createLungGeometry(-1, sex),
      leftLung: createLungGeometry(1, sex),
      airways: createAirwayGeometries(),
      liver: createLiverGeometry(sex),
      pancreas: createPancreasGeometry(),
      spleen: createSpleenGeometry(),
      thymus: createThymusGeometry(),
    }),
    [sex]
  );

  const spineVertebrae = useMemo(() => {
    const items: Array<{ y: number; z: number; rx: number }> = [];
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      const y = 1.36 - t * 1.48;
      const z = -0.065 + Math.sin(t * Math.PI * 2.1) * 0.018 - (t > 0.82 ? (t - 0.82) * 0.12 : 0);
      items.push({ y, z, rx: 0.026 + t * 0.018 });
    }
    return items;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.55;
      haloRef.current.rotation.x = Math.sin(t * 0.65) * 0.22;
    }
    if (pulseGroupRef.current) pulseGroupRef.current.position.y = -0.02 + Math.sin(t * 1.8) * 0.015;
    if (heartRef.current) {
      const beat = (t * 1.15) % 1;
      const d1 = (beat - 0.15) / 0.06;
      const d2 = (beat - 0.32) / 0.08;
      const s = 1 + Math.exp(-(d1 * d1)) * 0.11 + Math.exp(-(d2 * d2)) * 0.06;
      heartRef.current.scale.set(s, s, s);
    }
    if (lungsRef.current) {
      const b = Math.sin(t * 1.8);
      lungsRef.current.scale.set(1 + b * 0.035, 1 + b * 0.02, 1 + b * 0.035);
    }
    if (scanRingRef.current && showScannerBeam) scanRingRef.current.position.y = Math.sin(t * 0.85) * 1.88;
  });

  // ── Visibility by peel level ──────────────────────────────────────────────
  const showSkin = peel === 'body';
  const visible = (id: OrganId) => ORGAN_BY_ID[id].levels.includes(peel);
  const showBones = true;
  const bonesActive = peel === 'skeleton';
  const showRibs = peel === 'body' || peel === 'skeleton' || peel === 'organs';
  const showVessels = peel === 'body' || peel === 'organs';
  const showLymph = peel !== 'skeleton';
  const boneOpacity = (o: number) => (peel === 'body' || bonesActive ? o : o * 0.3);

  // ── Materials ─────────────────────────────────────────────────────────────
  const organMat = (id: OrganId, opacity: number, opaque = false) => {
    const st = organStatus[id];
    const color = hexFor(st);
    const sel = selectedOrgan === id;
    const hov = hoveredOrgan === id;
    return {
      color,
      emissive: color,
      emissiveIntensity: sel ? 0.9 : hov ? 0.72 : st === 2 ? 1.0 : 0.38,
      transparent: !opaque,
      opacity: opaque ? 1 : sel || hov ? Math.min(1, opacity + 0.18) : opacity,
      roughness: 0.25,
      metalness: 0.25,
    };
  };
  const neutralMat = (opacity: number) => ({
    color: NEUTRAL_HEX,
    emissive: '#0284c7',
    emissiveIntensity: 0.3,
    transparent: true,
    opacity,
    roughness: 0.3,
    metalness: 0.2,
  });
  const boneMat = (o: number) => organMat('bones', boneOpacity(o), bonesActive);
  const skinMat = (core = false) => {
    const st = organStatus.muscles;
    const alert = st != null && st > 0;
    const sel = selectedOrgan === 'muscles' || hoveredOrgan === 'muscles';
    return {
      color: alert ? hexFor(st) : sel ? '#38bdf8' : isFemale ? '#22d3ee' : '#38bdf8',
      emissive: alert ? hexFor(st) : '#0284c7',
      emissiveIntensity: alert ? 0.5 : sel ? 0.38 : 0.22,
      transparent: true,
      opacity: alert ? 0.52 : sel ? 0.5 : core ? 0.42 : 0.42,
      roughness: 0.22,
      metalness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    };
  };

  // Only the organs active at this peel level get pointer handlers. Meshes without handlers are
  // not raycast, so they never block a click on the organ behind them.
  const events = (id: OrganId) =>
    visible(id)
      ? {
          onClick: (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onSelectOrgan(id);
          },
          onPointerOver: (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHoverOrgan(id);
          },
          onPointerOut: (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHoverOrgan(null);
          },
        }
      : {};

  return (
    <group>
    <group ref={pulseGroupRef} position={[0, -0.02, 0]}>
      {/* Pedestal */}
      <group position={[0, -1.98, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.82, 0.96, 64]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.38} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[0.52, 0.56, 48]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[0.8, 64]} />
          <meshBasicMaterial color="#083344" transparent opacity={0.36} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {showScannerBeam && (
        <group ref={scanRingRef}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.58, 0.62, 64]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.58, 48]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.07} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}

      {/* ── Skin & muscles envelope (peel: Body) ── */}
      {showSkin && (
        <group {...events('muscles')}>
          <mesh geometry={anatomies.headAndNeck}>
            <meshPhysicalMaterial {...skinMat()} />
          </mesh>
          <mesh geometry={anatomies.torso}>
            <meshPhysicalMaterial {...skinMat(true)} />
          </mesh>
          <mesh geometry={anatomies.leftArm}>
            <meshPhysicalMaterial {...skinMat()} />
          </mesh>
          <mesh geometry={anatomies.rightArm}>
            <meshPhysicalMaterial {...skinMat()} />
          </mesh>
          <mesh geometry={anatomies.leftLeg}>
            <meshPhysicalMaterial {...skinMat()} />
          </mesh>
          <mesh geometry={anatomies.rightLeg}>
            <meshPhysicalMaterial {...skinMat()} />
          </mesh>
        </group>
      )}
      {showSkin && (
        <group>
          {[anatomies.headAndNeck, anatomies.torso, anatomies.leftLeg, anatomies.rightLeg].map((g, i) => (
            <mesh key={i} geometry={g}>
              <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={i === 1 ? 0.055 : 0.04} depthWrite={false} />
            </mesh>
          ))}
        </group>
      )}

      {/* Behavioural halo (decorative) */}
      {peel !== 'skeleton' && (
        <group ref={haloRef} position={[0, 1.72, 0]}>
          <mesh rotation={[Math.PI / 2.3, 0, 0]}>
            <torusGeometry args={[0.36, 0.014, 16, 64]} />
            <meshStandardMaterial {...neutralMat(0.6)} />
          </mesh>
          <mesh rotation={[-Math.PI / 3.1, 0.42, 0]}>
            <torusGeometry args={[0.42, 0.01, 16, 64]} />
            <meshStandardMaterial {...neutralMat(0.45)} />
          </mesh>
        </group>
      )}

      {/* ── Brain ── */}
      {visible('brain') && (
        <group {...events('brain')}>
          <mesh position={[-0.022, 1.745, -0.01]} geometry={anatomies.rightBrainHemisphere}>
            <meshStandardMaterial {...organMat('brain', 0.9)} />
          </mesh>
          <mesh position={[0.022, 1.745, -0.01]} geometry={anatomies.leftBrainHemisphere}>
            <meshStandardMaterial {...organMat('brain', 0.9)} />
          </mesh>
          <mesh position={[0, 1.615, -0.095]} geometry={anatomies.cerebellum}>
            <meshStandardMaterial {...organMat('brain', 0.85)} />
          </mesh>
          <mesh position={[0, 1.48, -0.04]} rotation={[0.12, 0, 0]}>
            <cylinderGeometry args={[0.026, 0.018, 0.22, 14]} />
            <meshStandardMaterial {...organMat('brain', 0.85)} />
          </mesh>
          {anatomies.neuroVascular.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...organMat('brain', 0.82)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Eyes + optic nerves ── */}
      {visible('eyes') && (
        <group {...events('eyes')}>
          {([-1, 1] as const).map((side) => (
            <group key={side} position={[side * 0.068, 1.64, 0.145]}>
              <mesh>
                <sphereGeometry args={[0.032, 20, 20]} />
                <meshStandardMaterial {...organMat('eyes', 0.98)} />
              </mesh>
              <mesh position={[0, 0, 0.028]}>
                <ringGeometry args={[0.008, 0.018, 20]} />
                <meshBasicMaterial color="#e0f2fe" side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[-side * 0.018, 0, -0.055]} rotation={[Math.PI / 2, 0, side * 0.26]}>
                <cylinderGeometry args={[0.014, 0.018, 0.11, 14]} />
                <meshStandardMaterial {...organMat('eyes', 0.96)} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* ── Heart ── */}
      {visible('heart') && (
        <group {...events('heart')}>
          <group ref={heartRef} position={[0.04, 0.75, 0.06]} rotation={[0.12, -0.15, -0.22]}>
            <mesh geometry={anatomies.heart}>
              <meshStandardMaterial {...organMat('heart', 0.96)} />
            </mesh>
          </group>
        </group>
      )}

      {/* ── Lungs + trachea ── */}
      {visible('lungs') && (
        <group {...events('lungs')}>
          {anatomies.airways.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...organMat('lungs', 0.78)} />
            </mesh>
          ))}
          <group ref={lungsRef}>
            <mesh position={[isFemale ? -0.115 : -0.145, 0.8, 0.008]} geometry={anatomies.rightLung}>
              <meshStandardMaterial {...organMat('lungs', 0.54)} />
            </mesh>
            <mesh position={[isFemale ? 0.12 : 0.15, 0.8, 0.008]} geometry={anatomies.leftLung}>
              <meshStandardMaterial {...organMat('lungs', 0.54)} />
            </mesh>
          </group>
        </group>
      )}

      {/* Vessels (not an organ target) */}
      {showVessels && (
        <group>
          {anatomies.vascularTree.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...neutralMat(0.55)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Liver & Pancreas (Metabolic & Nutrition) ── */}
      {visible('liver') && (
        <group {...events('liver')}>
          <mesh position={[isFemale ? -0.055 : -0.065, 0.49, 0.035]} rotation={[0.05, 0, 0.1]} geometry={anatomies.liver}>
            <meshStandardMaterial {...organMat('liver', 0.6)} />
          </mesh>
          <mesh position={[0.015, 0.39, 0.025]} rotation={[0.04, 0.08, 0.12]} geometry={anatomies.pancreas}>
            <meshStandardMaterial {...organMat('liver', 0.85)} />
          </mesh>
        </group>
      )}

      {/* ── Spleen ── */}
      {visible('spleen') && (
        <group {...events('spleen')}>
          <mesh position={[isFemale ? 0.175 : 0.21, 0.46, 0.005]} rotation={[0.08, -0.2, -0.32]} geometry={anatomies.spleen}>
            <meshStandardMaterial {...organMat('spleen', 0.92)} />
          </mesh>
        </group>
      )}

      {/* ── Kidneys (posterior, either side of the spine) ── */}
      {visible('kidneys') && (
        <group {...events('kidneys')}>
          {([-1, 1] as const).map((side) => (
            <group key={side} position={[side * (isFemale ? 0.09 : 0.1), side < 0 ? 0.32 : 0.34, -0.07]} rotation={[0, 0, side * 0.28]}>
              <mesh scale={[0.58, 1, 0.5]}>
                <sphereGeometry args={[0.07, 24, 24]} />
                <meshStandardMaterial {...organMat('kidneys', 0.92)} />
              </mesh>
              {/* Ureter */}
              <mesh position={[-side * 0.02, -0.17, 0.01]} rotation={[0, 0, -side * 0.12]}>
                <cylinderGeometry args={[0.006, 0.006, 0.26, 8]} />
                <meshStandardMaterial {...organMat('kidneys', 0.8)} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* Immune tissue: thymus, lymph conduits and nodes (shown, not a separate target) */}
      {showLymph && (
        <group>
          {(peel === 'body' || peel === 'organs') && (
            <mesh position={[0, 1.02, 0.082]} geometry={anatomies.thymus}>
              <meshStandardMaterial {...neutralMat(0.7)} />
            </mesh>
          )}
          {anatomies.lymphaticConduits.map((geo, idx) => (
            <mesh key={idx} geometry={geo}>
              <meshStandardMaterial {...neutralMat(0.45)} />
            </mesh>
          ))}
          {(
            [
              [-0.06, 1.32, 0.04],
              [0.06, 1.32, 0.04],
              [isFemale ? -0.27 : -0.34, 0.92, 0.04],
              [isFemale ? 0.27 : 0.34, 0.92, 0.04],
              [0.0, 0.32, 0.05],
              [isFemale ? -0.16 : -0.14, -0.15, 0.08],
              [isFemale ? 0.16 : 0.14, -0.15, 0.08],
            ] as V3[]
          ).map((pos, idx) => (
            <mesh key={idx} position={pos}>
              <sphereGeometry args={[0.032, 14, 14]} />
              <meshStandardMaterial {...neutralMat(0.75)} />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Bones (clickable on the Skeleton level; faint behind organs) ── */}
      {showBones && (
        <group {...(bonesActive ? events('bones') : {})}>
          {spineVertebrae.map((v, idx) => (
            <mesh key={idx} position={[0, v.y, v.z]}>
              <cylinderGeometry args={[v.rx, v.rx * 1.04, 0.062, 16]} />
              <meshStandardMaterial {...boneMat(0.92)} />
            </mesh>
          ))}
          {showRibs && (
            <>
              <mesh position={[0, 0.84, isFemale ? 0.145 : 0.182]} rotation={[0.12, 0, 0]} scale={[1, 1, 0.35]}>
                <capsuleGeometry args={[0.032, 0.34, 8, 16]} />
                <meshStandardMaterial {...boneMat(0.9)} />
              </mesh>
              {anatomies.ribs.map((g, idx) => (
                <mesh key={idx} geometry={g}>
                  <meshStandardMaterial {...boneMat(0.76)} />
                </mesh>
              ))}
            </>
          )}
          {anatomies.pelvis.map((g, idx) => (
            <mesh key={idx} geometry={g}>
              <meshStandardMaterial {...boneMat(0.9)} />
            </mesh>
          ))}
          {anatomies.limbBones.map((g, idx) => (
            <mesh key={idx} geometry={g}>
              <meshStandardMaterial {...boneMat(0.92)} />
            </mesh>
          ))}
          {([-1, 1] as const).map((side) => {
            const shX = side * (isFemale ? 0.355 : 0.45);
            const elbX = side * (isFemale ? 0.465 : 0.575);
            const acetX = side * (isFemale ? 0.185 : 0.155);
            const kneeX = side * (isFemale ? 0.152 : 0.17);
            return (
              <group key={side}>
                <mesh position={[shX, 1.04, -0.01]}>
                  <sphereGeometry args={[isFemale ? 0.034 : 0.042, 16, 16]} />
                  <meshStandardMaterial {...boneMat(0.92)} />
                </mesh>
                <mesh position={[elbX, 0.48, -0.032]}>
                  <sphereGeometry args={[isFemale ? 0.028 : 0.034, 14, 14]} />
                  <meshStandardMaterial {...boneMat(0.9)} />
                </mesh>
                <mesh position={[acetX, -0.16, 0.02]}>
                  <sphereGeometry args={[0.038, 16, 16]} />
                  <meshStandardMaterial {...boneMat(0.96)} />
                </mesh>
                <mesh position={[kneeX, -1.0, 0.022]}>
                  <sphereGeometry args={[isFemale ? 0.036 : 0.042, 16, 16]} />
                  <meshStandardMaterial {...boneMat(0.94)} />
                </mesh>
              </group>
            );
          })}
        </group>
      )}

    </group>

      {/* ── Markers: one button per visible organ. Kept out of the breathing group so they hold
           still and are easy to hit. ── */}
      {ORGANS.filter((o) => visible(o.id)).map((o) => {
        const st = organStatus[o.id];
        const problem = st != null && st > 0;
        const style = statusStyle(st);
        const sel = selectedOrgan === o.id;
        return (
          <Html key={o.id} position={anchorFor(o.id, isFemale)} center zIndexRange={[20, 0]}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectOrgan(o.id);
              }}
              onPointerEnter={() => onHoverOrgan(o.id)}
              onPointerLeave={() => onHoverOrgan(null)}
              aria-label={`${o.label}: ${style.text}. Open details`}
              title={`${o.label} · ${style.text}`}
              className="group relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              style={{ width: problem ? 26 : 18, height: problem ? 26 : 18, cursor: 'pointer' }}
            >
              {problem ? (
                <span
                  className="flex h-full w-full items-center justify-center rounded-full border-2 font-mono text-sm font-black text-white shadow-lg"
                  style={{
                    borderColor: sel ? '#ffffff' : hexFor(st),
                    background: `${hexFor(st)}cc`,
                    boxShadow: `0 0 12px ${hexFor(st)}`,
                    animation: st === 2 ? 'organ-ping 1.6s ease-in-out infinite' : undefined,
                  }}
                >
                  !
                </span>
              ) : (
                <span
                  className="block rounded-full border"
                  style={{
                    width: 10,
                    height: 10,
                    background: hexFor(st),
                    borderColor: sel ? '#ffffff' : '#0f172a',
                    boxShadow: sel ? '0 0 0 3px #ffffff55' : undefined,
                  }}
                />
              )}
              <span className="pointer-events-none absolute left-full ml-1.5 hidden whitespace-nowrap rounded bg-slate-950/90 px-1.5 py-0.5 font-mono text-[10px] text-slate-100 group-hover:block group-focus-visible:block">
                {o.label}
              </span>
            </button>
            <style>{'@keyframes organ-ping{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}@media (prefers-reduced-motion: reduce){[style*="organ-ping"]{animation:none!important}}'}</style>
          </Html>
        );
      })}
    </group>
  );
};

export const OrganTwinModel = memo(OrganTwinModelImpl);
