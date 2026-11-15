/**
 * ARGUS — Parametric 3D Anatomical Mesh Generators (`anatomicalGeometry.ts`)
 * Single Source of Truth: specs/00-architecture.md & specs/02-ui-dashboard.md
 *
 * Generates smooth, high-resolution, anatomically proportioned 3D `THREE.BufferGeometry`
 * meshes with explicit Male (`'male'`) and Female (`'female'`) morphological differentiation
 * across dermal/muscular envelopes, skeletal structures, and visceral organs.
 */

import * as THREE from 'three';
import { BiologicalSex } from '../types/argus';

/**
 * Smooth piecewise cubic Hermite / Catmull-Rom 1D profile evaluator.
 */
function sampleProfile(
  t: number,
  stops: Array<[number, number]>
): number {
  const clamped = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, v0] = stops[i];
    const [t1, v1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const localT = (clamped - t0) / Math.max(1e-6, t1 - t0);
      // Smoothstep-blended Catmull-Rom tangents
      const pPrev = stops[Math.max(0, i - 1)][1];
      const pNext = stops[Math.min(stops.length - 1, i + 2)][1];
      const m0 = 0.5 * (v1 - pPrev);
      const m1 = 0.5 * (pNext - v0);
      const t2 = localT * localT;
      const t3 = t2 * localT;
      return (
        (2 * t3 - 3 * t2 + 1) * v0 +
        (t3 - 2 * t2 + localT) * m0 +
        (-2 * t3 + 3 * t2) * v1 +
        (t3 - t2) * m1
      );
    }
  }
  return stops[stops.length - 1][1];
}

function gaussian(x: number, mean: number, sigma: number): number {
  const d = (x - mean) / sigma;
  return Math.exp(-0.5 * d * d);
}

/**
 * 1. SCULPTED CRANIUM, FACIAL FEATURES & NECK GEOMETRY
 * Spans y = 1.15 (trapezius/clavicular root) to y = 1.94 (cranial vertex).
 */
export function createSculptedHeadAndNeckGeometry(
  sex: BiologicalSex
): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const yMin = 1.15;
  const yMax = 1.94;
  const height = yMax - yMin;

  const radialSegments = 56;
  const heightSegments = 56;
  const geom = new THREE.CylinderGeometry(
    1,
    1,
    height,
    radialSegments,
    heightSegments,
    false
  );

  const pos = geom.attributes.position;
  const vertex = new THREE.Vector3();

  // Lateral half-width (Rx) from neck base (v=0) to crown (v=1)
  const rxStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.165], // Trapezius/clavicular flare into torso
        [0.12, 0.096], // Lower neck
        [0.28, 0.092], // Upper neck
        [0.36, 0.118], // Mandibular angle / chin transition
        [0.48, 0.148], // Cheekbones / zygomatic arch (tapered oval face)
        [0.64, 0.172], // Temple / supraorbital level
        [0.78, 0.182], // Parietal cranium
        [0.92, 0.145], // Upper cranial dome
        [1.0, 0.02], // Crown apex
      ]
    : [
        [0.0, 0.205], // Broader muscular trapezius flare
        [0.12, 0.118], // Thicker muscular neck
        [0.28, 0.114], // Upper neck
        [0.36, 0.146], // Broader, squarer gonial jaw angle
        [0.48, 0.164], // Zygomatic arch
        [0.64, 0.184], // Temple / brow level
        [0.78, 0.194], // Parietal cranium
        [0.92, 0.155], // Upper cranial dome
        [1.0, 0.02], // Crown apex
      ];

  // Anterior-Posterior half-depth (Rz)
  const rzStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.12],
        [0.14, 0.096],
        [0.3, 0.098],
        [0.4, 0.165], // Chin & mandible projection
        [0.54, 0.185], // Mid-face
        [0.7, 0.208], // Frontal-occipital cranial depth
        [0.86, 0.19],
        [0.95, 0.13],
        [1.0, 0.02],
      ]
    : [
        [0.0, 0.138],
        [0.14, 0.114],
        [0.3, 0.115],
        [0.4, 0.182], // Stronger chin & jaw projection
        [0.54, 0.198],
        [0.7, 0.22], // Deeper cranium
        [0.86, 0.2],
        [0.95, 0.14],
        [1.0, 0.02],
      ];

  // Center Z offset (shifts face slightly forward & occiput backward)
  const zOffsetStops: Array<[number, number]> = [
    [0.0, -0.005],
    [0.25, 0.0],
    [0.42, 0.032], // Chin forward
    [0.58, 0.018], // Face
    [0.74, -0.018], // Occipital lobe bulge in back
    [0.9, -0.01],
    [1.0, 0.0],
  ];

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    const yWorld = vertex.y + (yMin + yMax) * 0.5;
    const v = Math.max(0, Math.min(1, (yWorld - yMin) / height));

    const rHoriz = Math.hypot(vertex.x, vertex.z);
    if (rHoriz < 1e-5) {
      pos.setXYZ(i, 0, yWorld, sampleProfile(v, zOffsetStops));
      continue;
    }

    const theta = Math.atan2(vertex.z, vertex.x); // sin(theta) > 0 is anterior (+Z)
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    let rx = sampleProfile(v, rxStops) * rHoriz;
    let rz = sampleProfile(v, rzStops) * rHoriz;
    const zCenter = sampleProfile(v, zOffsetStops);

    let x = rx * cosT;
    let z = rz * sinT + zCenter;

    // Sculpted anatomical details on the head & neck:
    if (sinT > 0) {
      // Anterior (+Z):
      // 1. Nose bridge & nasal tip (v in 0.48..0.66, central x ~ 0)
      const noseProfile =
        gaussian(v, 0.55, 0.055) * gaussian(cosT, 0, 0.18) * (isFemale ? 0.034 : 0.042);
      z += noseProfile;

      // 2. Supraorbital brow ridge (v ~ 0.67, stronger in male)
      const browRidge =
        gaussian(v, 0.67, 0.028) *
        gaussian(Math.abs(cosT), 0.35, 0.28) *
        (isFemale ? 0.008 : 0.022);
      z += browRidge;

      // 3. Recessed orbital eye sockets (v ~ 0.62, |cosT| ~ 0.42)
      const eyeSocket =
        gaussian(v, 0.62, 0.032) * gaussian(Math.abs(cosT), 0.42, 0.16) * 0.024;
      z -= eyeSocket;

      // 4. Male laryngeal prominence (Adam's apple) & sternocleidomastoid V-muscles
      if (!isFemale) {
        z += gaussian(v, 0.22, 0.035) * gaussian(cosT, 0, 0.22) * 0.014;
      }
      const scmMuscle =
        gaussian(v, 0.15, 0.09) * gaussian(Math.abs(cosT), 0.52, 0.18) * 0.01;
      z += scmMuscle;
    } else {
      // Posterior (-Z): Suboccipital / nuchal indentation at base of skull (v ~ 0.34)
      const nuchalHollow =
        gaussian(v, 0.34, 0.05) * gaussian(cosT, 0, 0.4) * 0.018;
      z += nuchalHollow;
    }

    // Jawline gonial definition in male vs smooth taper in female
    if (v > 0.32 && v < 0.48 && !isFemale) {
      x += Math.sign(cosT) * gaussian(v, 0.39, 0.04) * gaussian(Math.abs(cosT), 0.75, 0.2) * 0.014;
    }

    pos.setXYZ(i, x, yWorld, z);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * 2. SCULPTED CONTINUOUS TORSO, CHEST, WAIST, PELVIS & GLUTEAL GEOMETRY
 * Spans y = -0.30 (lower pelvic/gluteal base) to y = 1.20 (trapezius/neck junction).
 * Differentiates:
 * - Female: Slender ribcage, sculpted bilateral mammary/breast contours, pronounced hourglass
 *   waist indentation (v=0.43), flared iliac/trochanteric hips (v=0.15), fuller rounded glutes.
 * - Male: Broad V-tapered latissimus dorsi & biacromial shoulders, sculpted pectoralis major
 *   plates, rectus abdominis & external obliques, narrower athletic pelvis & compact glutes.
 */
export function createSculptedTorsoGeometry(
  sex: BiologicalSex
): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const yMin = -0.30;
  const yMax = 1.20;
  const height = yMax - yMin;

  const radialSegments = 72;
  const heightSegments = 84;
  const geom = new THREE.CylinderGeometry(
    1,
    1,
    height,
    radialSegments,
    heightSegments,
    false
  );

  const pos = geom.attributes.position;
  const vertex = new THREE.Vector3();

  // Lateral half-width Rx(v)
  const rxStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.295], // Lower pelvic / upper thigh transition
        [0.07, 0.375], // Lower hip / gluteal flare
        [0.16, 0.402], // Greater trochanter / maximum feminine hip flare
        [0.27, 0.362], // Iliac crest / high hip curve
        [0.43, 0.232], // Defined feminine natural waist (WHR ~ 0.58)
        [0.56, 0.278], // Lower thoracic / inframammary ribcage
        [0.7, 0.308], // Mid-thorax
        [0.83, 0.348], // Upper chest / axillary fold
        [0.9, 0.368], // Acromial shoulder shelf
        [0.96, 0.23], // Trapezius slope
        [1.0, 0.145], // Neck root blend
      ]
    : [
        [0.0, 0.285], // Lower pelvic base
        [0.07, 0.322], // Lower hip
        [0.16, 0.33], // Compact male trochanter / hip
        [0.27, 0.322], // Iliac crest
        [0.4, 0.305], // Athletic waist with obliques
        [0.56, 0.358], // Lower ribcage / latissimus flare begins
        [0.72, 0.418], // Broad mid-thorax / latissimus dorsi V-taper
        [0.85, 0.468], // Upper chest / deltoid-pectoral junction
        [0.91, 0.478], // Broad male biacromial shoulder shelf
        [0.96, 0.275], // Muscular trapezius slope
        [1.0, 0.18], // Neck root blend
      ];

  // Base AP half-depth Rz(v)
  const rzStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.155],
        [0.12, 0.195], // Pelvic/gluteal depth
        [0.26, 0.182],
        [0.43, 0.158], // Slender waist depth
        [0.58, 0.182],
        [0.72, 0.196], // Ribcage depth (mammary contour added on +Z)
        [0.86, 0.176],
        [0.94, 0.142],
        [1.0, 0.112],
      ]
    : [
        [0.0, 0.165],
        [0.12, 0.2],
        [0.26, 0.195],
        [0.4, 0.192], // Deeper muscular waist
        [0.58, 0.222],
        [0.74, 0.242], // Deep male thoracic cage
        [0.86, 0.215],
        [0.94, 0.162],
        [1.0, 0.13],
      ];

  // Natural spinal S-curve (lumbar lordosis & thoracic kyphosis)
  const zSpineOffsetStops: Array<[number, number]> = [
    [0.0, -0.01],
    [0.12, -0.018], // Gluteal prominence
    [0.38, 0.016], // Lumbar lordosis forward curve
    [0.68, -0.012], // Thoracic kyphosis
    [0.9, 0.0],
    [1.0, -0.005],
  ];

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    const yWorld = vertex.y + (yMin + yMax) * 0.5;
    const v = Math.max(0, Math.min(1, (yWorld - yMin) / height));

    const rHoriz = Math.hypot(vertex.x, vertex.z);
    if (rHoriz < 1e-5) {
      pos.setXYZ(i, 0, yWorld, sampleProfile(v, zSpineOffsetStops));
      continue;
    }

    const theta = Math.atan2(vertex.z, vertex.x);
    const cosT = Math.cos(theta); // Lateral (-1 left, +1 right)
    const sinT = Math.sin(theta); // AP (+1 front, -1 back)

    const rx = sampleProfile(v, rxStops) * rHoriz;
    const rz = sampleProfile(v, rzStops) * rHoriz;
    const zCenter = sampleProfile(v, zSpineOffsetStops);

    let x = rx * cosT;
    let z = rz * sinT + zCenter;

    const absX = Math.abs(x);

    // =========================================================
    // ANTERIOR TORSO SCULPTING (+Z: Chest, Abs, Pelvis)
    // =========================================================
    if (sinT > 0) {
      if (isFemale) {
        // 1. Anatomically sculpted bilateral mammary / breast contours
        // Centered at v ~ 0.675 (y ~ 0.71), |x| ~ 0.135, with natural teardrop asymmetry
        // (gentler upper slope, fuller lower pole) and central sternal cleavage valley.
        const vBreastDiff = v - 0.665;
        const vSigma = vBreastDiff > 0 ? 0.085 : 0.058; // Teardrop vertical profile
        const breastVert = Math.exp(-0.5 * (vBreastDiff / vSigma) ** 2);
        const breastLat =
          gaussian(absX, 0.132, 0.068) * (1 - 0.82 * gaussian(absX, 0, 0.032));
        const breastProj = 0.112 * breastVert * breastLat * (sinT ** 0.7);
        z += breastProj;
        // Subtle lateral fullness of breast contour
        x += Math.sign(x) * 0.018 * breastVert * gaussian(absX, 0.18, 0.05) * sinT;

        // 2. Clavicular ridge (v ~ 0.87)
        const clavicle =
          gaussian(v, 0.875, 0.018) * gaussian(absX, 0.15, 0.09) * 0.014 * sinT;
        z += clavicle;

        // 3. Soft feminine linea alba & hypogastric belly curve + umbilicus (v ~ 0.37)
        const softBelly =
          gaussian(v, 0.32, 0.095) * gaussian(absX, 0, 0.12) * 0.018 * sinT;
        const navel =
          gaussian(v, 0.38, 0.015) * gaussian(absX, 0, 0.016) * 0.016 * sinT;
        z += softBelly - navel;
      } else {
        // 1. Male Pectoralis Major muscle plates
        // Broad, flat-arched bilateral chest plates (v in 0.63..0.83) with crisp inferior border
        // and central sternal furrow
        const pecVert =
          gaussian(v, 0.735, 0.072) *
          (v < 0.65 ? Math.max(0, 1 - ((0.65 - v) / 0.04) ** 2) : 1);
        const pecLat =
          gaussian(absX, 0.165, 0.095) * (1 - 0.88 * gaussian(absX, 0, 0.026));
        z += 0.056 * pecVert * pecLat * (sinT ** 0.6);

        // Clavicular bar (v ~ 0.88)
        z += gaussian(v, 0.88, 0.02) * gaussian(absX, 0.18, 0.11) * 0.016 * sinT;

        // 2. Rectus Abdominis (6-pack muscle bellies) & Linea Alba (v in 0.28..0.61)
        if (v > 0.26 && v < 0.63) {
          const abEnvelope =
            gaussian(v, 0.45, 0.12) *
            gaussian(absX, 0.068, 0.042) *
            (1 - 0.9 * gaussian(absX, 0, 0.016));
          // 3 horizontal tendinous intersections at v = 0.36, 0.46, 0.56
          const tendons =
            1 -
            0.45 *
              (gaussian(v, 0.36, 0.012) +
                gaussian(v, 0.46, 0.012) +
                gaussian(v, 0.56, 0.012));
          z += 0.024 * abEnvelope * tendons * sinT;
        }

        // External oblique muscular flank ridge (v ~ 0.34, |x| ~ 0.24)
        x +=
          Math.sign(x) *
          gaussian(v, 0.33, 0.065) *
          gaussian(absX, 0.25, 0.06) *
          0.016;
      }

      // Inguinal / pelvic V-line groove at lower abdomen (v ~ 0.10..0.20)
      const inguinalGroove =
        gaussian(v - 0.08 - absX * 0.35, 0, 0.022) *
        gaussian(absX, 0.16, 0.08) *
        0.014 *
        sinT;
      z -= inguinalGroove;
    }

    // =========================================================
    // POSTERIOR TORSO SCULPTING (-Z: Spine Furrow, Scapulae, Glutes)
    // =========================================================
    if (sinT < 0) {
      const backSin = -sinT;

      // 1. Median spinal furrow (indented along x = 0 from lumbar to upper thoracic)
      const spineGroove =
        gaussian(absX, 0, 0.026) *
        (v > 0.24 && v < 0.88 ? 1 : 0) *
        0.026 *
        backSin;
      z += spineGroove; // +Z moves inward toward body center since z is negative

      // 2. Bilateral Erector Spinae & Scapular musculature
      const erector =
        gaussian(absX, 0.075, 0.04) *
        gaussian(v, 0.52, 0.22) *
        (isFemale ? 0.016 : 0.026) *
        backSin;
      const scapula =
        gaussian(absX, isFemale ? 0.14 : 0.18, 0.065) *
        gaussian(v, 0.76, 0.075) *
        (isFemale ? 0.018 : 0.03) *
        backSin;
      z -= erector + scapula;

      // 3. Bilateral Gluteus Maximus contours (v in 0.02..0.24) with intergluteal cleft
      const gluteVert = gaussian(v, 0.125, isFemale ? 0.075 : 0.068);
      const gluteLat =
        gaussian(absX, isFemale ? 0.135 : 0.12, isFemale ? 0.085 : 0.075) *
        (1 - 0.92 * gaussian(absX, 0, 0.022));
      const gluteProj = (isFemale ? 0.068 : 0.048) * gluteVert * gluteLat * backSin;
      z -= gluteProj;
    }

    // Crotch / perineal saddle arch at bottom center (v < 0.07, |x| < 0.09)
    if (v < 0.07 && absX < 0.095) {
      const archLift =
        (1 - v / 0.07) * gaussian(absX, 0, 0.055) * 0.085;
      pos.setXYZ(i, x, yWorld + archLift, z);
    } else {
      pos.setXYZ(i, x, yWorld, z);
    }
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * 3. SCULPTED UPPER LIMB GEOMETRY (Deltoid, Biceps/Triceps, Elbow, Forearm, Wrist & Hand)
 * Continuous anatomical mesh along a natural slight A-pose curve so the torso/waist/hip
 * silhouette remains completely clear.
 */
export function createSculptedArmGeometry(
  sex: BiologicalSex,
  side: -1 | 1
): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const radialSegments = 36;
  const heightSegments = 56;

  const geom = new THREE.CylinderGeometry(
    1,
    1,
    1,
    radialSegments,
    heightSegments,
    false
  );
  const pos = geom.attributes.position;
  const vertex = new THREE.Vector3();

  // Centerline curve from shoulder (s=0) -> elbow (s=0.45) -> wrist (s=0.82) -> fingertips (s=1.0)
  const xStops: Array<[number, number]> = isFemale
    ? [
        [0.0, side * 0.345], // Deltoid root inside shoulder
        [0.12, side * 0.395], // Deltoid cap
        [0.45, side * 0.465], // Elbow
        [0.82, side * 0.535], // Wrist
        [0.92, side * 0.55], // Palm
        [1.0, side * 0.555], // Fingertips
      ]
    : [
        [0.0, side * 0.44], // Broad male shoulder root
        [0.12, side * 0.505], // Prominent male deltoid cap
        [0.45, side * 0.575], // Elbow
        [0.82, side * 0.645], // Wrist
        [0.92, side * 0.66], // Palm
        [1.0, side * 0.665], // Fingertips
      ];

  const yStops: Array<[number, number]> = [
    [0.0, 1.07], // Acromion / top of deltoid
    [0.12, 0.94], // Upper humerus
    [0.45, 0.48], // Elbow joint
    [0.82, 0.02], // Wrist joint
    [0.92, -0.09], // Mid-palm
    [1.0, -0.21], // Fingertips
  ];

  const zStops: Array<[number, number]> = [
    [0.0, -0.01],
    [0.25, -0.022],
    [0.45, -0.032], // Elbow slightly posterior
    [0.82, 0.035], // Forearm angles naturally forward
    [0.92, 0.052], // Palm
    [1.0, 0.06], // Fingers
  ];

  // Medio-lateral radius Rx(s)
  const rxStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.068],
        [0.1, 0.082], // Female deltoid contour
        [0.28, 0.068], // Toned biceps/triceps
        [0.45, 0.058], // Elbow
        [0.56, 0.062], // Upper forearm
        [0.82, 0.038], // Slender wrist
        [0.9, 0.028], // Hand thickness
        [0.98, 0.018],
        [1.0, 0.006],
      ]
    : [
        [0.0, 0.088],
        [0.1, 0.112], // Muscular male deltoid cap
        [0.28, 0.094], // Muscular biceps/triceps belly
        [0.45, 0.074], // Elbow
        [0.56, 0.084], // Pronounced brachioradialis forearm
        [0.82, 0.048], // Male wrist
        [0.9, 0.034], // Hand thickness
        [0.98, 0.022],
        [1.0, 0.008],
      ];

  // Antero-posterior radius Rz(s)
  const rzStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.072],
        [0.1, 0.084],
        [0.28, 0.074],
        [0.45, 0.062],
        [0.56, 0.065],
        [0.82, 0.046],
        [0.9, 0.064], // Broad palm front-to-back
        [0.98, 0.052], // Fingers
        [1.0, 0.012],
      ]
    : [
        [0.0, 0.092],
        [0.1, 0.114],
        [0.28, 0.102], // Deep biceps/triceps AP profile
        [0.45, 0.078],
        [0.56, 0.086],
        [0.82, 0.056],
        [0.9, 0.076], // Broad male palm
        [0.98, 0.062],
        [1.0, 0.014],
      ];

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    // Cylinder has y in [-0.5, +0.5]; s = 0 at top (+0.5), s = 1 at bottom (-0.5)
    const s = Math.max(0, Math.min(1, 0.5 - vertex.y));
    const rHoriz = Math.hypot(vertex.x, vertex.z);
    const theta = Math.atan2(vertex.z, vertex.x);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const cx = sampleProfile(s, xStops);
    const cy = sampleProfile(s, yStops);
    const cz = sampleProfile(s, zStops);

    const rx = sampleProfile(s, rxStops) * rHoriz;
    const rz = sampleProfile(s, rzStops) * rHoriz;

    let x = cx + rx * cosT;
    const y = cy;
    let z = cz + rz * sinT;

    // Biceps peak on anterior upper arm (s ~ 0.27, sinT > 0)
    if (sinT > 0) {
      z +=
        gaussian(s, 0.27, 0.07) *
        (isFemale ? 0.008 : 0.022) *
        sinT *
        rHoriz;
    }
    // Triceps sweep on posterior upper arm (s ~ 0.24, sinT < 0)
    if (sinT < 0) {
      z -=
        gaussian(s, 0.24, 0.07) *
        (isFemale ? 0.007 : 0.018) *
        (-sinT) *
        rHoriz;
    }
    // Thumb projection on anterior edge of palm (s ~ 0.88, sinT > 0.5)
    if (s > 0.83 && s < 0.94 && sinT > 0.4) {
      z += gaussian(s, 0.885, 0.025) * (sinT - 0.4) * 0.045 * rHoriz;
    }

    pos.setXYZ(i, x, y, z);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * 4. SCULPTED LOWER LIMB GEOMETRY (Hip/Thigh, Quadriceps/Hamstrings, Knee/Patella, Calf, Ankle & Foot)
 * Differentiates:
 * - Female: Wider pelvic hip origin, natural femorotibial Q-angle converging gently toward the knees,
 *   fuller outer upper thigh curve, contoured gastrocnemius calf, slender ankle & proportioned foot.
 * - Male: Straighter femoral shaft, prominent vastus lateralis & vastus medialis (teardrop quad),
 *   stronger patella & gastrocnemius calf heads, broader ankle & foot.
 */
export function createSculptedLegGeometry(
  sex: BiologicalSex,
  side: -1 | 1
): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const radialSegments = 44;
  const heightSegments = 68;

  const geom = new THREE.CylinderGeometry(
    1,
    1,
    1,
    radialSegments,
    heightSegments,
    false
  );
  const pos = geom.attributes.position;
  const vertex = new THREE.Vector3();

  // Centerline from upper thigh/hip (s=0, y=-0.10) to sole of foot (s=1, y=-1.96)
  const xStops: Array<[number, number]> = isFemale
    ? [
        [0.0, side * 0.21], // Wide female pelvic hip origin
        [0.24, side * 0.182], // Mid-thigh Q-angle convergence
        [0.48, side * 0.152], // Knee joint
        [0.66, side * 0.156], // Calf
        [0.9, side * 0.15], // Ankle
        [1.0, side * 0.155], // Foot
      ]
    : [
        [0.0, side * 0.175], // Narrower male pelvic hip origin
        [0.24, side * 0.175], // Straighter mid-thigh
        [0.48, side * 0.17], // Knee joint
        [0.66, side * 0.174], // Calf
        [0.9, side * 0.168], // Ankle
        [1.0, side * 0.174], // Foot
      ];

  const yStops: Array<[number, number]> = [
    [0.0, -0.10], // Blends smoothly into lower pelvis/glutes
    [0.24, -0.56], // Mid-thigh
    [0.48, -1.00], // Knee center
    [0.66, -1.34], // Calf muscle belly
    [0.9, -1.78], // Ankle malleoli
    [0.96, -1.90], // Dorsal foot / heel
    [1.0, -1.96], // Plantar sole on pedestal
  ];

  const zStops: Array<[number, number]> = [
    [0.0, -0.008],
    [0.24, 0.006], // Slight anterior femoral bow
    [0.48, 0.004], // Knee
    [0.66, -0.016], // Calf shifts slightly posterior
    [0.9, -0.012], // Ankle
    [0.96, 0.045], // Foot extends forward (+Z)
    [1.0, 0.055],
  ];

  // Medio-lateral half-width Rx(s)
  const rxStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.185], // Matches female outer hip (0.21 + 0.185 = 0.395!)
        [0.14, 0.168], // Upper thigh sweep
        [0.3, 0.135], // Mid-thigh taper
        [0.48, 0.088], // Knee
        [0.64, 0.092], // Gastrocnemius calf
        [0.82, 0.058], // Lower shin
        [0.9, 0.05], // Slender ankle
        [0.96, 0.068], // Foot width
        [1.0, 0.062],
      ]
    : [
        [0.0, 0.155], // Matches male outer hip (0.175 + 0.155 = 0.33!)
        [0.14, 0.158], // Upper quad
        [0.3, 0.148], // Muscular vastus lateralis sweep
        [0.48, 0.098], // Stronger male knee
        [0.64, 0.104], // Broad male gastrocnemius calf
        [0.82, 0.068], // Lower shin
        [0.9, 0.058], // Ankle
        [0.96, 0.078], // Foot width
        [1.0, 0.072],
      ];

  // Antero-posterior half-depth Rz(s)
  const rzStops: Array<[number, number]> = isFemale
    ? [
        [0.0, 0.185],
        [0.2, 0.158],
        [0.48, 0.094],
        [0.64, 0.102],
        [0.9, 0.058],
        [0.96, 0.135], // Foot heel-to-toe length
        [1.0, 0.13],
      ]
    : [
        [0.0, 0.188],
        [0.2, 0.172], // Deep male quadriceps/hamstrings
        [0.48, 0.104],
        [0.64, 0.114],
        [0.9, 0.066],
        [0.96, 0.15], // Longer male foot
        [1.0, 0.145],
      ];

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    const s = Math.max(0, Math.min(1, 0.5 - vertex.y));
    const rHoriz = Math.hypot(vertex.x, vertex.z);
    const theta = Math.atan2(vertex.z, vertex.x);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const cx = sampleProfile(s, xStops);
    const cy = sampleProfile(s, yStops);
    const cz = sampleProfile(s, zStops);

    const rx = sampleProfile(s, rxStops) * rHoriz;
    const rz = sampleProfile(s, rzStops) * rHoriz;

    let x = cx + rx * cosT;
    let y = cy;
    let z = cz + rz * sinT;

    // Prevent inner thighs from overlapping across the midline x=0 near s=0..0.2
    if (side === 1 && x < 0.018) x = 0.018 + (x - 0.018) * 0.2;
    if (side === -1 && x > -0.018) x = -0.018 + (x + 0.018) * 0.2;

    // Sculpted Quadriceps (Rectus femoris & Vastus medialis teardrop above knee)
    if (sinT > 0 && s < 0.52) {
      const quadBellies =
        gaussian(s, 0.24, 0.11) * (isFemale ? 0.014 : 0.026) * sinT * rHoriz;
      const patellaCap =
        gaussian(s, 0.48, 0.028) * gaussian(cosT, 0, 0.45) * 0.018 * sinT * rHoriz;
      z += quadBellies + patellaCap;
    }

    // Sculpted Gastrocnemius calf belly on posterior lower leg (s ~ 0.62, sinT < 0)
    if (sinT < 0 && s > 0.48 && s < 0.85) {
      const calfBulge =
        gaussian(s, 0.62, 0.075) * (isFemale ? 0.022 : 0.032) * (-sinT) * rHoriz;
      z -= calfBulge;
    }

    // Flatten plantar sole at s > 0.97 so foot stands cleanly on the pedestal
    if (s > 0.96) {
      y = Math.max(-1.96, y);
    }

    pos.setXYZ(i, x, y, z);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * 5. SEX-DIMORPHIC SKELETAL RIBCAGE & PELVIC GIRDLE GEOMETRIES
 * Generates 10 pairs of 3D curved thoracic ribs + sex-differentiated iliac crests.
 */
export function createThoracicRibGeometries(
  sex: BiologicalSex
): THREE.BufferGeometry[] {
  const isFemale = sex === 'female';
  const ribs: THREE.BufferGeometry[] = [];
  const ribLevels = [1.02, 0.95, 0.88, 0.81, 0.74, 0.67, 0.60, 0.53, 0.46, 0.40];

  for (let idx = 0; idx < ribLevels.length; idx++) {
    const yBase = ribLevels[idx];
    const t = idx / (ribLevels.length - 1);
    // Thoracic width envelope (wider in male, more tapered in female)
    const archScale = Math.sin(t * Math.PI * 0.82 + 0.35);
    const widthX = (isFemale ? 0.255 : 0.335) * (0.72 + 0.28 * archScale);
    const depthZ = (isFemale ? 0.155 : 0.195) * (0.75 + 0.25 * archScale);
    const isFloating = idx >= 8;

    for (const side of [-1, 1] as const) {
      const pts: THREE.Vector3[] = [];
      const maxAngle = isFloating ? Math.PI * 0.68 : Math.PI * 0.94;
      const steps = 18;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        // Start at posterior spine (angle = -PI/2) and wrap around lateral wall to anterior sternum (+PI/2)
        const angle = -Math.PI / 2 + u * maxAngle;
        const px = side * Math.cos(angle) * widthX;
        const pz = Math.sin(angle) * depthZ;
        // Ribs slope slightly downward from spine to anterior costal cartilage
        const py = yBase - Math.sin(u * Math.PI * 0.75) * 0.045;
        pts.push(new THREE.Vector3(px, py, pz));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      ribs.push(new THREE.TubeGeometry(curve, 18, 0.0095, 8, false));
    }
  }

  return ribs;
}

export function createPelvicGirdleGeometries(
  sex: BiologicalSex
): THREE.BufferGeometry[] {
  const isFemale = sex === 'female';
  const parts: THREE.BufferGeometry[] = [];

  // Female pelvis: wider, more flared iliac wings, broader pelvic inlet, wider subpubic angle (>80 deg)
  // Male pelvis: narrower, taller iliac wings, narrower heart-shaped inlet, acute subpubic angle
  const iliacWidth = isFemale ? 0.325 : 0.255;
  const iliacHeight = isFemale ? 0.11 : 0.145;
  const pubicDepth = isFemale ? 0.145 : 0.135;

  for (const side of [-1, 1] as const) {
    // Upper Iliac Crest & Wing Arch
    const crestCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.055, -0.06, -0.095), // Sacroiliac joint
      new THREE.Vector3(side * (iliacWidth * 0.68), 0.02 + (isFemale ? 0 : 0.02), -0.05),
      new THREE.Vector3(side * iliacWidth, -0.02 + iliacHeight * 0.2, 0.02), // Iliac crest peak
      new THREE.Vector3(side * (iliacWidth * 0.88), -0.11, 0.095), // ASIS (Anterior Superior Iliac Spine)
      new THREE.Vector3(side * (isFemale ? 0.195 : 0.165), -0.17, 0.04), // Acetabulum / hip socket
      new THREE.Vector3(side * 0.02, -0.23, pubicDepth), // Pubic symphysis
    ]);
    parts.push(new THREE.TubeGeometry(crestCurve, 28, 0.022, 10, false));

    // Lower Ischial / Obturator Ring
    const ischialCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * (isFemale ? 0.195 : 0.165), -0.17, 0.04), // Acetabulum
      new THREE.Vector3(side * (isFemale ? 0.16 : 0.125), -0.28, -0.03), // Ischial tuberosity
      new THREE.Vector3(side * 0.02, -0.23, pubicDepth), // Inferior pubic ramus
    ]);
    parts.push(new THREE.TubeGeometry(ischialCurve, 18, 0.016, 8, false));
  }

  return parts;
}

/**
 * 6. VASCULAR ARTERIAL / VENOUS TREE GEOMETRIES (`cardio` & `neuro`)
 * Generates 3D branching vessels (Aortic Arch, Descending Aorta, Iliac/Femoral Arteries,
 * Carotid/Jugular Tracts, Subclavian/Brachial Vessels).
 */
export function createVascularTreeGeometries(
  sex: BiologicalSex
): THREE.BufferGeometry[] {
  const isFemale = sex === 'female';
  const vessels: THREE.BufferGeometry[] = [];
  const hipX = isFemale ? 0.19 : 0.17;
  const shoulderX = isFemale ? 0.34 : 0.43;

  // 1. Aortic Arch + Descending Thoracic & Abdominal Aorta
  const aortaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, 0.78, 0.07), // Left ventricle outflow
    new THREE.Vector3(0.02, 0.94, 0.06), // Ascending aorta
    new THREE.Vector3(-0.02, 0.97, 0.02), // Aortic arch apex
    new THREE.Vector3(-0.03, 0.82, -0.02), // Upper descending thoracic aorta
    new THREE.Vector3(-0.01, 0.45, -0.01), // Diaphragmatic hiatus
    new THREE.Vector3(0.0, 0.05, 0.01), // Abdominal aorta bifurcation
  ]);
  vessels.push(new THREE.TubeGeometry(aortaCurve, 32, 0.018, 10, false));

  // 2. Bilateral Common Iliac & Femoral Arteries descending into legs
  for (const side of [-1, 1] as const) {
    const femoralCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.05, 0.01),
      new THREE.Vector3(side * (hipX * 0.55), -0.08, 0.02),
      new THREE.Vector3(side * (hipX * 0.9), -0.28, 0.03),
      new THREE.Vector3(side * (isFemale ? 0.165 : 0.17), -0.68, 0.02),
      new THREE.Vector3(side * (isFemale ? 0.15 : 0.168), -1.1, 0.0),
    ]);
    vessels.push(new THREE.TubeGeometry(femoralCurve, 24, 0.011, 8, false));

    // 3. Subclavian & Brachial Arteries extending into shoulders/arms
    const subclavianCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.95, 0.04),
      new THREE.Vector3(side * (shoulderX * 0.55), 1.02, 0.02),
      new THREE.Vector3(side * shoulderX, 0.98, 0.0),
      new THREE.Vector3(side * (shoulderX + 0.08), 0.62, -0.01),
    ]);
    vessels.push(new THREE.TubeGeometry(subclavianCurve, 20, 0.009, 8, false));
  }

  return vessels;
}

/**
 * 7. CEREBRAL CAROTID / JUGULAR NEURO-VASCULAR TRACTS (`neuro`)
 */
export function createNeuroVascularGeometries(): THREE.BufferGeometry[] {
  const tracts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1] as const) {
    const carotidCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.035, 0.96, 0.04),
      new THREE.Vector3(side * 0.055, 1.25, 0.03),
      new THREE.Vector3(side * 0.06, 1.52, 0.02),
      new THREE.Vector3(side * 0.075, 1.68, 0.04),
    ]);
    tracts.push(new THREE.TubeGeometry(carotidCurve, 18, 0.0085, 8, false));
  }
  return tracts;
}

/**
 * 8. APPENDICULAR SKELETON GEOMETRIES (Clavicles, Humeri, Radius/Ulna, Femoral Necks, Femurs, Tibia/Fibula)
 * Aligned to the exact sex-specific limb centerlines.
 */
export function createAppendicularSkeletonGeometries(
  sex: BiologicalSex
): THREE.BufferGeometry[] {
  const isFemale = sex === 'female';
  const bones: THREE.BufferGeometry[] = [];

  for (const side of [-1, 1] as const) {
    const shX = side * (isFemale ? 0.355 : 0.45);
    const elbX = side * (isFemale ? 0.465 : 0.575);
    const wrX = side * (isFemale ? 0.535 : 0.645);

    // 1. Clavicle (S-curve from manubrium sternum to acromion)
    const clavicleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.035, 1.07, 0.095),
      new THREE.Vector3(side * (isFemale ? 0.18 : 0.23), 1.09, 0.07),
      new THREE.Vector3(shX, 1.06, 0.0),
    ]);
    bones.push(new THREE.TubeGeometry(clavicleCurve, 16, 0.013, 8, false));

    // 2. Humerus (Shoulder to Elbow)
    const humerusCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(shX, 1.04, -0.01),
      new THREE.Vector3((shX + elbX) * 0.5, 0.76, -0.022),
      new THREE.Vector3(elbX, 0.48, -0.032),
    ]);
    bones.push(
      new THREE.TubeGeometry(
        humerusCurve,
        16,
        isFemale ? 0.019 : 0.023,
        10,
        false
      )
    );

    // 3. Radius & Ulna (Elbow to Wrist)
    const radiusCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(elbX + side * 0.012, 0.47, -0.03),
      new THREE.Vector3(wrX + side * 0.01, 0.02, 0.035),
    ]);
    const ulnaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(elbX - side * 0.012, 0.47, -0.034),
      new THREE.Vector3(wrX - side * 0.01, 0.02, 0.03),
    ]);
    bones.push(new THREE.TubeGeometry(radiusCurve, 14, 0.011, 8, false));
    bones.push(new THREE.TubeGeometry(ulnaCurve, 14, 0.011, 8, false));

    // 4. Femoral Head, Neck & Shaft (Acetabulum -> Greater Trochanter -> Knee)
    // Female Q-angle converges more steeply from wider pelvic acetabulum to knee
    const acetabulumX = side * (isFemale ? 0.185 : 0.155);
    const trochanterX = side * (isFemale ? 0.235 : 0.195);
    const kneeX = side * (isFemale ? 0.152 : 0.17);
    const ankleX = side * (isFemale ? 0.15 : 0.168);

    const femurCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(acetabulumX, -0.16, 0.02), // Femoral head in acetabulum
      new THREE.Vector3(trochanterX, -0.22, 0.0), // Femoral neck -> greater trochanter
      new THREE.Vector3((trochanterX + kneeX) * 0.5, -0.6, 0.008), // Mid femoral shaft
      new THREE.Vector3(kneeX, -0.99, 0.005), // Distal femoral condyles
    ]);
    bones.push(
      new THREE.TubeGeometry(
        femurCurve,
        24,
        isFemale ? 0.024 : 0.028,
        10,
        false
      )
    );

    // 5. Tibia & Fibula (Knee to Ankle)
    const tibiaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(kneeX - side * 0.008, -1.02, 0.005),
      new THREE.Vector3(ankleX - side * 0.006, -1.78, -0.01),
    ]);
    const fibulaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(kneeX + side * 0.022, -1.04, -0.01),
      new THREE.Vector3(ankleX + side * 0.018, -1.78, -0.018),
    ]);
    bones.push(
      new THREE.TubeGeometry(
        tibiaCurve,
        18,
        isFemale ? 0.019 : 0.022,
        10,
        false
      )
    );
    bones.push(new THREE.TubeGeometry(fibulaCurve, 16, 0.009, 8, false));
  }

  return bones;
}

/**
 * 9. LYMPHATIC CONDUIT NETWORK (`immune`)
 */
export function createLymphaticConduitGeometries(
  sex: BiologicalSex
): THREE.BufferGeometry[] {
  const isFemale = sex === 'female';
  const conduits: THREE.BufferGeometry[] = [];
  const axillaX = isFemale ? 0.27 : 0.34;
  const inguinalX = isFemale ? 0.16 : 0.14;

  // Thoracic duct (cisterna chyli at y=0.35 ascending to thymic/subclavian confluence at y=1.08)
  const thoracicDuct = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 0.32, 0.05),
    new THREE.Vector3(-0.02, 0.72, 0.06),
    new THREE.Vector3(0.0, 1.08, 0.08),
  ]);
  conduits.push(new THREE.TubeGeometry(thoracicDuct, 20, 0.007, 8, false));

  for (const side of [-1, 1] as const) {
    // Axillary & Cervical lymphatic trunks
    const upperLymph = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.06, 1.32, 0.04), // Cervical nodes
      new THREE.Vector3(0.0, 1.08, 0.08), // Thymic core
      new THREE.Vector3(side * axillaX, 0.92, 0.04), // Axillary nodes
    ]);
    conduits.push(new THREE.TubeGeometry(upperLymph, 18, 0.006, 8, false));

    // Inguinal & Iliac lymphatic trunks
    const lowerLymph = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.32, 0.05),
      new THREE.Vector3(side * (inguinalX * 0.65), 0.08, 0.06),
      new THREE.Vector3(side * inguinalX, -0.15, 0.08), // Inguinal nodes
    ]);
    conduits.push(new THREE.TubeGeometry(lowerLymph, 18, 0.006, 8, false));
  }

  return conduits;
}

/**
 * 10. SCULPTED VISCERAL ORGAN GEOMETRIES (`neuro`, `cardio`, `immune`)
 * Replaces primitive spheroids with anatomically contoured, vertex-sculpted BufferGeometries.
 */

/**
 * Gyri-sculpted cerebral hemisphere with flat medial longitudinal fissure wall,
 * temporal lobe protrusion, Sylvian fissure, and frontal/occipital pole shaping.
 * `side`: -1 = right hemisphere (viewer left, x < 0), +1 = left hemisphere (viewer right, x > 0).
 */
export function createBrainHemisphereGeometry(
  side: -1 | 1
): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 36, 28);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.098;
  const ry = 0.118;
  const rz = 0.148;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    const lateralSign = ux * side; // > 0 on outer lateral convexity, < 0 on medial wall

    let x = ux;
    let y = uy;
    let z = uz;

    // Flatten medial wall facing the longitudinal fissure
    if (lateralSign < 0) {
      x *= 0.16;
    }

    // Frontal pole taper (anterior +z) and occipital pole projection (posterior -z)
    if (uz > 0.15) {
      const frontT = (uz - 0.15) / 0.85;
      x *= 1 - 0.22 * frontT * frontT;
      y -= 0.08 * frontT * frontT;
    } else if (uz < -0.25) {
      const occT = (-0.25 - uz) / 0.75;
      x *= 1 - 0.26 * occT * occT;
      z -= 0.06 * occT;
    }

    // Temporal lobe ventral-lateral bulge
    const temporalMask =
      Math.max(0, lateralSign) *
      gaussian(uy, -0.32, 0.34) *
      gaussian(uz, 0.08, 0.38);
    x += side * 0.16 * temporalMask;
    y -= 0.14 * temporalMask;

    // Sylvian (lateral) fissure indentation above temporal lobe
    const sylvianMask =
      Math.max(0, lateralSign) *
      gaussian(uy, -0.02, 0.11) *
      gaussian(uz, 0.14, 0.32);
    x -= side * 0.11 * sylvianMask;

    // Subtle organic gyri/sulci surface convolutions (attenuated on flat medial wall)
    const gyriMask = lateralSign > 0 ? Math.min(1, lateralSign * 2.2) : 0.15;
    const gyri =
      0.028 *
      gyriMask *
      (Math.sin(ux * 12 + uz * 9) * Math.cos(uy * 11 - uz * 8) +
        0.5 * Math.sin(uy * 16 + ux * 13));
    const radialLen = Math.sqrt(x * x + y * y + z * z) || 1;
    x += (x / radialLen) * gyri;
    y += (y / radialLen) * gyri;
    z += (z / radialLen) * gyri;

    pos.setXYZ(i, x * rx, y * ry, z * rz);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Bilobed cerebellum with central vermis notch and subtle horizontal folia ridges.
 */
export function createCerebellumGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 32, 22);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.092;
  const ry = 0.054;
  const rz = 0.062;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    // Central vermis indentation (especially posterior-inferior)
    const vermisNotch = 1 - 0.26 * gaussian(ux, 0, 0.22) * (uz < 0.2 ? 1 : 0.4);
    // Lateral cerebellar hemisphere fullness
    const lobeFullness = 1 + 0.14 * gaussian(Math.abs(ux), 0.56, 0.26);
    // Subtle horizontal folia ridges
    const folia = 1 + 0.032 * Math.sin(uy * 26);

    const scale = vermisNotch * lobeFullness * folia;
    pos.setXYZ(i, ux * rx * scale, uy * ry * scale, uz * rz * scale);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Anatomically tapered, asymmetric 4-chamber heart silhouette:
 * broad superior-posterior base, oblique left-anterior apex, and coronary/interventricular sulci.
 */
export function createHeartGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 36, 28);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.072;
  const ry = 0.096;
  const rz = 0.068;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    // Normalized height: 0 = apex (bottom), 1 = base (top)
    const h = (uy + 1) * 0.5;

    // Conical taper toward cardiac apex
    const taper = 0.34 + 0.66 * Math.pow(Math.max(0, h), 0.56);

    // Oblique shift of apex toward anatomical left (+x) and anterior (+z)
    const apexShiftX = 0.28 * (1 - h) * (1 - h);
    const apexShiftZ = 0.14 * (1 - h);

    // Coronary (atrioventricular) sulcus around h = 0.68
    const avSulcus = 1 - 0.08 * gaussian(h, 0.68, 0.065);

    // Anterior interventricular sulcus
    const ivSulcus =
      uz > 0.15
        ? 1 - 0.06 * gaussian(ux - 0.18 * uy, 0.04, 0.13) * Math.min(1, uz * 1.5)
        : 1;

    // Slightly flatter diaphragmatic (inferior-posterior) surface
    let y = uy;
    if (uy < -0.25 && uz < 0.1) {
      y *= 0.88;
    }

    // Subtle atrial auricular fullness at superior base
    const atrialSpread = h > 0.68 ? 1 + 0.12 * gaussian(h, 0.82, 0.12) : 1;

    const rScale = taper * avSulcus * ivSulcus * atrialSpread;
    pos.setXYZ(
      i,
      (ux * rScale + apexShiftX) * rx,
      y * ry,
      (uz * rScale + apexShiftZ) * rz
    );
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Sculpted pulmonary lobe geometry with conical apex, concave diaphragmatic base,
 * flat mediastinal wall, lobar fissure creases, and left-sided cardiac notch.
 * `side`: -1 = right lung (3 lobes, x < 0), +1 = left lung (2 lobes + cardiac notch, x > 0).
 */
export function createLungGeometry(
  side: -1 | 1,
  sex: BiologicalSex
): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const geom = new THREE.SphereGeometry(1, 36, 28);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = (isFemale ? 0.088 : 0.108) * (side === -1 ? 1.06 : 0.94);
  const ry = isFemale ? 0.182 : 0.202;
  const rz = isFemale ? 0.092 : 0.108;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    const h = (uy + 1) * 0.5; // 0 = diaphragmatic base, 1 = apex
    const lateralSign = ux * side; // > 0 outer costal wall, < 0 inner mediastinal wall

    let x = ux;
    let y = uy;
    let z = uz;

    // Conical taper toward pulmonary apex
    const apexTaper = 1 - 0.64 * Math.pow(Math.max(0, h - 0.32) / 0.68, 1.35);
    x *= apexTaper;
    z *= 0.45 + 0.55 * apexTaper;

    // Flatten mediastinal (inner) surface facing heart/spine
    if (lateralSign < 0) {
      x *= 0.42;
    }

    // Concave diaphragmatic base (arches upward inferiorly)
    if (uy < -0.42) {
      const baseT = (-0.42 - uy) / 0.58;
      const centerDome = Math.max(0, 1 - 0.45 * (ux * ux + uz * uz));
      y += 0.26 * Math.pow(baseT, 1.25) * centerDome;
    }

    // Left lung cardiac notch (anterior-medial-inferior concavity for the heart)
    if (side === 1) {
      const notchMask =
        gaussian(ux, -0.35, 0.55) *
        gaussian(uy, -0.32, 0.44) *
        gaussian(uz, 0.48, 0.52);
      x += 0.36 * notchMask;
      z -= 0.18 * notchMask;
    }

    // Lobar fissure indentations
    const obliqueFissure = 1 - 0.055 * gaussian(uy + 0.42 * uz, -0.04, 0.065);
    const horizontalFissure =
      side === -1 && uz > -0.1
        ? 1 - 0.045 * gaussian(uy, 0.16, 0.055) * Math.min(1, (uz + 0.1) * 2)
        : 1;
    const fissureScale = obliqueFissure * horizontalFissure;

    pos.setXYZ(i, x * rx * fissureScale, y * ry, z * rz * fissureScale);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Trachea & bifurcating left/right primary bronchi (`cardio`).
 */
export function createAirwayGeometries(): THREE.BufferGeometry[] {
  const tracheaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.24, 0.025),
    new THREE.Vector3(0, 1.1, 0.022),
    new THREE.Vector3(0, 0.96, 0.015), // Carina
  ]);
  const rightBronchus = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.96, 0.015),
    new THREE.Vector3(-0.045, 0.92, 0.012),
    new THREE.Vector3(-0.095, 0.87, 0.01),
  ]);
  const leftBronchus = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.96, 0.015),
    new THREE.Vector3(0.05, 0.91, 0.012),
    new THREE.Vector3(0.1, 0.86, 0.01),
  ]);

  return [
    new THREE.TubeGeometry(tracheaCurve, 16, 0.017, 12, false),
    new THREE.TubeGeometry(rightBronchus, 12, 0.0125, 10, false),
    new THREE.TubeGeometry(leftBronchus, 12, 0.0115, 10, false),
  ];
}

/**
 * Wedge-shaped asymmetric liver silhouette: large rounded right lobe (x < 0)
 * tapering across the midline into a thinner pointed left lobe (x > 0).
 */
export function createLiverGeometry(sex: BiologicalSex): THREE.BufferGeometry {
  const isFemale = sex === 'female';
  const geom = new THREE.SphereGeometry(1, 34, 24);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = isFemale ? 0.145 : 0.172;
  const ry = 0.082;
  const rz = isFemale ? 0.092 : 0.108;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x; // -1 = far right lobe, +1 = far left lobe tip
    const uy = v.y;
    const uz = v.z;

    const uNorm = (ux + 1) * 0.5; // 0 (right) -> 1 (left)

    // Thick right lobe tapering smoothly to a thin left lobe
    const heightProfile = 1.18 - 0.88 * Math.pow(uNorm, 1.35);
    const depthProfile = 1.06 - 0.58 * Math.pow(uNorm, 1.5);

    // Concave inferior visceral slope (angled up toward anterior-left)
    let y = uy * heightProfile;
    if (uy < 0) {
      y += 0.24 * Math.abs(uy) * (0.35 + 0.65 * uNorm);
    }

    // Subtle falciform ligament notch between right and left lobes
    const falciformNotch = 1 - 0.09 * gaussian(ux, 0.18, 0.11);

    pos.setXYZ(
      i,
      ux * rx,
      y * ry * falciformNotch,
      uz * rz * depthProfile * falciformNotch
    );
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Crescent/bean-shaped spleen with convex diaphragmatic surface and concave medial hilum.
 */
export function createSpleenGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 28, 20);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.044;
  const ry = 0.078;
  const rz = 0.058;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    // Slight crescent curve along vertical axis
    const poleTaper = 1 - 0.28 * uy * uy;
    let x = ux * poleTaper;
    // Indent medial hilum (ux < 0) and bow lateral diaphragmatic face (ux > 0)
    if (ux < 0) {
      x *= 0.55;
    }
    x += 0.22 * (1 - uy * uy);

    const z = uz * poleTaper - 0.16 * uy * uy;

    pos.setXYZ(i, x * rx, uy * ry, z * rz);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Bilobed anterior mediastinal thymus gland with central isthmus waist.
 */
export function createThymusGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 28, 20);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.052;
  const ry = 0.058;
  const rz = 0.026;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;

    // Central isthmus pinch separating left and right thymic lobes
    const poleFactor = 0.35 + 0.65 * Math.min(1, Math.abs(uy) * 1.4);
    const isthmusPinch = 1 - 0.48 * gaussian(ux, 0, 0.22) * poleFactor;
    // Taper superiorly into cervical horns
    const superiorTaper = uy > 0 ? 1 - 0.28 * uy : 1 + 0.08 * Math.abs(uy);

    pos.setXYZ(
      i,
      ux * rx * superiorTaper,
      uy * ry * isthmusPinch,
      uz * rz * isthmusPinch
    );
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Retroperitoneal pancreas & metabolic core: broader head on the right (-x), tapering tail toward the left (+x).
 */
export function createPancreasGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 28, 20);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  const rx = 0.115;
  const ry = 0.032;
  const rz = 0.028;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ux = v.x; // -1 (head, right) to +1 (tail, left)
    const uy = v.y;
    const uz = v.z;

    // Head is thicker/taller on right (-x), tapering toward splenic tail (+x)
    const taper = ux < 0 ? 1.15 - 0.15 * Math.abs(ux) : 1 - 0.55 * ux;
    // Slight superior-posterior sweep toward left tail
    const y = uy * ry * taper + 0.018 * ux;
    const z = uz * rz * taper - 0.015 * ux * ux;

    pos.setXYZ(i, ux * rx, y, z);
  }

  geom.computeVertexNormals();
  return geom;
}

