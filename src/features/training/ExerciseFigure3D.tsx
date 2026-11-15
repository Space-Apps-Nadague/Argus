/**
 * ARGUS — Animated 3-D training figure (specs/02-ui-dashboard.md §2.6 Training)
 * A simple mannequin that performs the selected exercise in a loop. Joint positions come from
 * `mannequin.ts` (feet, back or hands stay on the floor); drag to rotate, scroll to zoom.
 */

import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { EXERCISE_MOTIONS, lerpPose, placeSkeleton, repetitionPhase, SEG, type P2, type Skeleton } from './mannequin';

const BODY = '#4dd0ff';
const JOINT = '#e6f7ff';
const ARM_X = 0.22;
const LEG_X = 0.1;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface Bone {
  from: (s: Skeleton) => P2;
  to: (s: Skeleton) => P2;
  x: number;
  r: number;
  len: number;
}

const BONES: Bone[] = [
  { from: (s) => s.pelvis, to: (s) => s.neck, x: 0, r: 0.13, len: SEG.torso },
  { from: (s) => s.shoulder, to: (s) => s.elbowL, x: ARM_X, r: 0.045, len: SEG.upperArm },
  { from: (s) => s.elbowL, to: (s) => s.handL, x: ARM_X, r: 0.04, len: SEG.forearm },
  { from: (s) => s.shoulder, to: (s) => s.elbowR, x: -ARM_X, r: 0.045, len: SEG.upperArm },
  { from: (s) => s.elbowR, to: (s) => s.handR, x: -ARM_X, r: 0.04, len: SEG.forearm },
  { from: (s) => s.pelvis, to: (s) => s.kneeL, x: LEG_X, r: 0.065, len: SEG.thigh },
  { from: (s) => s.kneeL, to: (s) => s.ankleL, x: LEG_X, r: 0.05, len: SEG.shin },
  { from: (s) => s.ankleL, to: (s) => s.toeL, x: LEG_X, r: 0.035, len: SEG.foot },
  { from: (s) => s.pelvis, to: (s) => s.kneeR, x: -LEG_X, r: 0.065, len: SEG.thigh },
  { from: (s) => s.kneeR, to: (s) => s.ankleR, x: -LEG_X, r: 0.05, len: SEG.shin },
  { from: (s) => s.ankleR, to: (s) => s.toeR, x: -LEG_X, r: 0.035, len: SEG.foot },
];

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

const Mannequin: React.FC<{ exerciseId: string; playing: boolean }> = ({ exerciseId, playing }) => {
  const motion = EXERCISE_MOTIONS[exerciseId];
  const boneRefs = useRef<(THREE.Mesh | null)[]>([]);
  const headRef = useRef<THREE.Mesh>(null);
  const shoulderBar = useRef<THREE.Mesh>(null);
  const time = useRef(0);

  // Centre the exercise on the mat: middle of the start pose along z.
  const centreZ = useMemo(() => {
    const s = placeSkeleton(motion.from, motion.rig);
    const zs = Object.values(s).map((p) => p.z);
    return (Math.min(...zs) + Math.max(...zs)) / 2;
  }, [motion]);

  const geometries = useMemo(
    () => BONES.map((b) => new THREE.CapsuleGeometry(b.r, Math.max(0.01, b.len - 2 * b.r), 6, 12)),
    []
  );

  useFrame((_, delta) => {
    if (playing) time.current += Math.min(delta, 0.1);
    const t = repetitionPhase(time.current, motion.period);
    const s = placeSkeleton(lerpPose(motion.from, motion.to, t), motion.rig);
    BONES.forEach((b, i) => {
      const mesh = boneRefs.current[i];
      if (!mesh) return;
      const p = b.from(s);
      const q = b.to(s);
      tmpA.set(b.x, p.y, p.z - centreZ);
      tmpB.set(b.x, q.y, q.z - centreZ);
      mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      tmpDir.copy(tmpB).sub(tmpA).normalize();
      mesh.quaternion.setFromUnitVectors(Y_AXIS, tmpDir);
    });
    headRef.current?.position.set(0, s.head.y, s.head.z - centreZ);
    shoulderBar.current?.position.set(0, s.shoulder.y, s.shoulder.z - centreZ);
  });

  return (
    <group>
      {BONES.map((b, i) => (
        <mesh key={i} ref={(m) => (boneRefs.current[i] = m)} geometry={geometries[i]} castShadow>
          <meshStandardMaterial color={BODY} roughness={0.45} metalness={0.1} />
        </mesh>
      ))}
      <mesh ref={shoulderBar} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.06, ARM_X * 2 - 0.12, 6, 12]} />
        <meshStandardMaterial color={BODY} roughness={0.45} />
      </mesh>
      <mesh ref={headRef} castShadow>
        <sphereGeometry args={[0.11, 24, 16]} />
        <meshStandardMaterial color={JOINT} roughness={0.3} />
      </mesh>
    </group>
  );
};

export const ExerciseFigure3D: React.FC<{ exerciseId: string; playing: boolean }> = ({ exerciseId, playing }) => (
  <Canvas
    shadows
    dpr={[1, 1.75]}
    camera={{ position: [2.6, 1.1, 0.9], fov: 40 }}
    aria-label="Animated 3-D figure showing the exercise"
    role="img"
  >
    <color attach="background" args={['#0b1220']} />
    <ambientLight intensity={0.55} />
    <directionalLight position={[3, 4, 2]} intensity={1.1} castShadow />
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[1.4, 2.4]} />
      <meshStandardMaterial color="#1e2b3c" />
    </mesh>
    <gridHelper args={[6, 24, '#24364d', '#162233']} position={[0, -0.001, 0]} />
    <Mannequin exerciseId={exerciseId} playing={playing} />
    <OrbitControls target={[0, 0.45, 0]} enablePan={false} minDistance={1.5} maxDistance={6} />
  </Canvas>
);
