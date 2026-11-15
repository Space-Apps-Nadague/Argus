/**
 * ARGUS — Animated 3-D training astronaut (specs/02-ui-dashboard.md §2.6 Training)
 * An astronaut figure (white suit, helmet with gold visor, life-support pack) that performs the
 * selected exercise in a loop, with the equipment it needs: ARED bar and load cables, treadmill
 * with bungee harness, or cycle ergometer. Joint positions come from `mannequin.ts`
 * (feet, back or hands stay on the floor); drag to rotate, scroll to zoom.
 */

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { aredBar, EXERCISE_MOTIONS, pedalPoints, SEG, skeletonAt, type P2, type Skeleton } from './mannequin';

const SUIT = '#eef2f6';
const SUIT_DARK = '#c9d2dc';
const BOOT = '#5b6573';
const VISOR = '#c8962e';
const PACK = '#d7dde4';
const ACCENT = '#2f6fdf';
const METAL = '#7d8a99';
const CABLE = '#4dd0ff';
const ARM_X = 0.24;
const LEG_X = 0.1;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface Bone {
  from: (s: Skeleton) => P2;
  to: (s: Skeleton) => P2;
  x: number;
  r: number;
  len: number;
  color: string;
}

const BONES: Bone[] = [
  { from: (s) => s.pelvis, to: (s) => s.neck, x: 0, r: 0.15, len: SEG.torso, color: SUIT },
  { from: (s) => s.shoulder, to: (s) => s.elbowL, x: ARM_X, r: 0.055, len: SEG.upperArm, color: SUIT },
  { from: (s) => s.elbowL, to: (s) => s.handL, x: ARM_X, r: 0.05, len: SEG.forearm, color: SUIT_DARK },
  { from: (s) => s.shoulder, to: (s) => s.elbowR, x: -ARM_X, r: 0.055, len: SEG.upperArm, color: SUIT },
  { from: (s) => s.elbowR, to: (s) => s.handR, x: -ARM_X, r: 0.05, len: SEG.forearm, color: SUIT_DARK },
  { from: (s) => s.pelvis, to: (s) => s.kneeL, x: LEG_X, r: 0.075, len: SEG.thigh, color: SUIT },
  { from: (s) => s.kneeL, to: (s) => s.ankleL, x: LEG_X, r: 0.062, len: SEG.shin, color: SUIT },
  { from: (s) => s.ankleL, to: (s) => s.toeL, x: LEG_X, r: 0.05, len: SEG.foot, color: BOOT },
  { from: (s) => s.pelvis, to: (s) => s.kneeR, x: -LEG_X, r: 0.075, len: SEG.thigh, color: SUIT },
  { from: (s) => s.kneeR, to: (s) => s.ankleR, x: -LEG_X, r: 0.062, len: SEG.shin, color: SUIT },
  { from: (s) => s.ankleR, to: (s) => s.toeR, x: -LEG_X, r: 0.05, len: SEG.foot, color: BOOT },
];

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const dir = new THREE.Vector3();
const off = new THREE.Vector3();

/** Puts a Y-axis mesh between two points (optionally stretching it to the distance). */
function span(mesh: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3, stretch = false) {
  if (!mesh) return;
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  dir.copy(b).sub(a);
  const len = dir.length();
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  if (stretch) mesh.scale.set(1, Math.max(len, 1e-3), 1);
}

const Astronaut: React.FC<{ exerciseId: string; playing: boolean }> = ({ exerciseId, playing }) => {
  const motion = EXERCISE_MOTIONS[exerciseId];
  const eq = motion.equipment;
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const helmet = useRef<THREE.Group>(null);
  const pack = useRef<THREE.Mesh>(null);
  const shoulders = useRef<THREE.Mesh>(null);
  const bar = useRef<THREE.Mesh>(null);
  const cables = useRef<(THREE.Mesh | null)[]>([]);
  const harness = useRef<(THREE.Mesh | null)[]>([]);
  const pedals = useRef<(THREE.Mesh | null)[]>([]);
  const cranks = useRef<(THREE.Mesh | null)[]>([]);
  const time = useRef(0);

  // Centre the exercise: middle of the start pose along z.
  const centreZ = useMemo(() => {
    const zs = Object.values(skeletonAt(motion, 0)).map((p) => p.z);
    return (Math.min(...zs) + Math.max(...zs)) / 2;
  }, [motion]);

  const geometries = useMemo(() => BONES.map((b) => new THREE.CapsuleGeometry(b.r, Math.max(0.01, b.len - 2 * b.r), 6, 14)), []);
  const unitCylinder = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8), []);

  useFrame((_, delta) => {
    if (playing) time.current += Math.min(delta, 0.1);
    const s = skeletonAt(motion, time.current);
    const p3 = (p: P2, x = 0, target = v1) => target.set(x, p.y, p.z - centreZ);

    BONES.forEach((b, i) => span(bones.current[i], p3(b.from(s), b.x, v1).clone(), p3(b.to(s), b.x, v2)));

    // Torso orientation: life-support pack behind it, shoulder yoke across it.
    p3(s.pelvis, 0, v1);
    p3(s.neck, 0, v2);
    const torsoQ = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.copy(v2).sub(v1).normalize());
    if (pack.current) {
      pack.current.quaternion.copy(torsoQ);
      off.set(0, 0, -0.2).applyQuaternion(torsoQ);
      pack.current.position.copy(v1).add(v2).multiplyScalar(0.5).add(off);
    }
    if (shoulders.current) {
      p3(s.shoulder, 0, shoulders.current.position);
      shoulders.current.quaternion.copy(torsoQ);
    }
    // Helmet faces along the neck → head direction; the visor sits on its local +z.
    if (helmet.current) {
      p3(s.head, 0, helmet.current.position);
      helmet.current.quaternion.setFromUnitVectors(Y_AXIS, dir.copy(p3(s.head, 0, v2)).sub(p3(s.neck, 0, v1)).normalize());
    }

    if (eq?.kind === 'ared') {
      const b = aredBar(s, eq.barAt);
      if (bar.current) p3(b, 0, bar.current.position);
      [-1, 1].forEach((side, i) => {
        p3(b, side * 0.5, v1);
        v2.set(side * 0.5, 0.06, b.z - centreZ);
        span(cables.current[i], v2, v1.clone(), true);
      });
    }
    if (eq?.kind === 'treadmill') {
      [-1, 1].forEach((side, i) => {
        p3(s.pelvis, side * 0.17, v1);
        v2.set(side * 0.55, 0.12, v1.z);
        span(harness.current[i], v2, v1.clone(), true);
      });
    }
    if (eq?.kind === 'cycle' && motion.rig.cycle) {
      const c = motion.rig.cycle;
      const angle = ((time.current % motion.period) / motion.period) * Math.PI * 2;
      const { left, right } = pedalPoints(c.crank, c.radius, angle);
      [left, right].forEach((pt, i) => {
        const x = i === 0 ? LEG_X : -LEG_X;
        if (pedals.current[i]) p3(pt, x, pedals.current[i]!.position);
        p3(c.crank, x, v1);
        span(cranks.current[i], v1.clone(), p3(pt, x, v2), true);
      });
    }
  });

  return (
    <group>
      {BONES.map((b, i) => (
        <mesh key={i} ref={(m) => (bones.current[i] = m)} geometry={geometries[i]} castShadow>
          <meshStandardMaterial color={b.color} roughness={0.55} />
        </mesh>
      ))}
      <mesh ref={shoulders} rotation={[0, 0, 0]}>
        <boxGeometry args={[ARM_X * 2 + 0.08, 0.12, 0.2]} />
        <meshStandardMaterial color={SUIT} roughness={0.55} />
      </mesh>
      <mesh ref={pack} castShadow>
        <boxGeometry args={[0.36, 0.46, 0.14]} />
        <meshStandardMaterial color={PACK} roughness={0.5} />
      </mesh>
      <group ref={helmet}>
        <mesh castShadow>
          <sphereGeometry args={[0.16, 28, 20]} />
          <meshStandardMaterial color={SUIT} roughness={0.3} />
        </mesh>
        {/* Gold visor: front cap of a slightly larger sphere */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <sphereGeometry args={[0.165, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
          <meshStandardMaterial color={VISOR} metalness={0.85} roughness={0.15} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.12, 0.025, 8, 24]} />
          <meshStandardMaterial color={ACCENT} roughness={0.4} />
        </mesh>
      </group>

      {eq?.kind === 'ared' && (
        <>
          <mesh position={[0, 0.03, 0]} receiveShadow>
            <boxGeometry args={[1.3, 0.06, 1.0]} />
            <meshStandardMaterial color="#3a4656" />
          </mesh>
          <mesh ref={bar} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 1.2, 12]} />
            <meshStandardMaterial color={METAL} metalness={0.7} roughness={0.3} />
          </mesh>
          {[0, 1].map((i) => (
            <mesh key={i} ref={(m) => (cables.current[i] = m)} geometry={unitCylinder} scale={[0.012, 1, 0.012]}>
              <meshStandardMaterial color={CABLE} emissive={CABLE} emissiveIntensity={0.4} />
            </mesh>
          ))}
        </>
      )}
      {eq?.kind === 'treadmill' && (
        <>
          <mesh position={[0, 0.04, 0]} receiveShadow>
            <boxGeometry args={[0.8, 0.08, 1.8]} />
            <meshStandardMaterial color="#26303d" />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.55, 0.12, 0]}>
              <boxGeometry args={[0.06, 0.08, 0.3]} />
              <meshStandardMaterial color={METAL} />
            </mesh>
          ))}
          {[0, 1].map((i) => (
            <mesh key={i} ref={(m) => (harness.current[i] = m)} geometry={unitCylinder} scale={[0.012, 1, 0.012]}>
              <meshStandardMaterial color={CABLE} emissive={CABLE} emissiveIntensity={0.4} />
            </mesh>
          ))}
        </>
      )}
      {eq?.kind === 'cycle' && motion.rig.cycle && (
        <>
          <mesh position={[0, motion.rig.cycle.crank.y / 2, motion.rig.cycle.crank.z - centreZ]}>
            <boxGeometry args={[0.08, motion.rig.cycle.crank.y, 0.08]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          <mesh position={[0, motion.rig.cycle.crank.y, motion.rig.cycle.crank.z - centreZ]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.07, 0.24, 20]} />
            <meshStandardMaterial color="#3a4656" />
          </mesh>
          <mesh position={[0, motion.rig.cycle.handlebar.y, motion.rig.cycle.handlebar.z - centreZ]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.5, 10]} />
            <meshStandardMaterial color={METAL} metalness={0.6} />
          </mesh>
          <mesh
            position={[0, (motion.rig.cycle.handlebar.y + motion.rig.cycle.crank.y) / 2, (motion.rig.cycle.handlebar.z + motion.rig.cycle.crank.z) / 2 - centreZ]}
            rotation={[Math.atan2(motion.rig.cycle.handlebar.z - motion.rig.cycle.crank.z, motion.rig.cycle.handlebar.y - motion.rig.cycle.crank.y), 0, 0]}
          >
            <boxGeometry args={[0.05, Math.hypot(motion.rig.cycle.handlebar.y - motion.rig.cycle.crank.y, motion.rig.cycle.handlebar.z - motion.rig.cycle.crank.z), 0.05]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
          {[0, 1].map((i) => (
            <React.Fragment key={i}>
              <mesh ref={(m) => (pedals.current[i] = m)}>
                <boxGeometry args={[0.1, 0.025, 0.12]} />
                <meshStandardMaterial color="#1c2430" />
              </mesh>
              <mesh ref={(m) => (cranks.current[i] = m)} geometry={unitCylinder} scale={[0.015, 1, 0.015]}>
                <meshStandardMaterial color={METAL} metalness={0.6} />
              </mesh>
            </React.Fragment>
          ))}
        </>
      )}
    </group>
  );
};

export const ExerciseFigure3D: React.FC<{ exerciseId: string; playing: boolean }> = ({ exerciseId, playing }) => (
  <Canvas shadows dpr={[1, 1.75]} camera={{ position: [2.7, 1.25, 1.1], fov: 40 }} aria-label="Animated 3-D astronaut showing the exercise" role="img">
    <color attach="background" args={['#0b1220']} />
    <ambientLight intensity={0.6} />
    <directionalLight position={[3, 4, 2]} intensity={1.15} castShadow />
    <directionalLight position={[-2, 2, -2]} intensity={0.35} color="#9ecbff" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[1.6, 2.6]} />
      <meshStandardMaterial color="#1e2b3c" />
    </mesh>
    <gridHelper args={[6, 24, '#24364d', '#162233']} position={[0, -0.001, 0]} />
    <Astronaut exerciseId={exerciseId} playing={playing} />
    <OrbitControls target={[0, 0.5, 0]} enablePan={false} minDistance={1.5} maxDistance={6} />
  </Canvas>
);
