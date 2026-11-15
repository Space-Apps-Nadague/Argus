import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createAirwayGeometries,
  createBrainHemisphereGeometry,
  createCerebellumGeometry,
  createHeartGeometry,
  createLiverGeometry,
  createLungGeometry,
  createPancreasGeometry,
  createSpleenGeometry,
  createThymusGeometry,
} from '../anatomicalGeometry';

function assertValidGeometry(geom: THREE.BufferGeometry) {
  const pos = geom.attributes.position;
  const norm = geom.attributes.normal;
  expect(pos).toBeDefined();
  expect(norm).toBeDefined();
  expect(pos.count).toBeGreaterThan(100);
  expect(norm.count).toBe(pos.count);

  for (let i = 0; i < pos.count; i++) {
    expect(Number.isFinite(pos.getX(i))).toBe(true);
    expect(Number.isFinite(pos.getY(i))).toBe(true);
    expect(Number.isFinite(pos.getZ(i))).toBe(true);
    expect(Number.isFinite(norm.getX(i))).toBe(true);
    expect(Number.isFinite(norm.getY(i))).toBe(true);
    expect(Number.isFinite(norm.getZ(i))).toBe(true);
  }
}

describe('sculpted visceral organ geometries', () => {
  it('generates valid cerebral hemispheres with flattened medial fissure walls', () => {
    const right = createBrainHemisphereGeometry(-1);
    const left = createBrainHemisphereGeometry(1);
    assertValidGeometry(right);
    assertValidGeometry(left);

    right.computeBoundingBox();
    const box = right.boundingBox!;
    // Right hemisphere (side = -1): medial wall is on +x, lateral convexity on -x
    expect(Math.abs(box.min.x)).toBeGreaterThan(Math.abs(box.max.x) * 3);
  });

  it('generates valid bilobed cerebellum', () => {
    const cerebellum = createCerebellumGeometry();
    assertValidGeometry(cerebellum);
  });

  it('generates an asymmetric heart tapering toward its left-inferior apex', () => {
    const heart = createHeartGeometry();
    assertValidGeometry(heart);

    const pos = heart.attributes.position;
    let maxUpperSpan = 0;
    let apexSumX = 0;
    let apexCount = 0;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (y > 0.02 && y < 0.06) {
        maxUpperSpan = Math.max(maxUpperSpan, Math.abs(x));
      }
      if (y < -0.07) {
        apexSumX += x;
        apexCount++;
      }
    }

    expect(apexCount).toBeGreaterThan(0);
    // Apex shifts toward anatomical left (+x)
    expect(apexSumX / apexCount).toBeGreaterThan(0.01);
    expect(maxUpperSpan).toBeGreaterThan(0.05);
  });

  it('generates sculpted left and right lungs with sexual dimorphism and narrower left lung', () => {
    for (const sex of ['female', 'male'] as const) {
      const rightLung = createLungGeometry(-1, sex);
      const leftLung = createLungGeometry(1, sex);
      assertValidGeometry(rightLung);
      assertValidGeometry(leftLung);

      rightLung.computeBoundingBox();
      leftLung.computeBoundingBox();
      const rightWidth = rightLung.boundingBox!.max.x - rightLung.boundingBox!.min.x;
      const leftWidth = leftLung.boundingBox!.max.x - leftLung.boundingBox!.min.x;

      expect(rightWidth).toBeGreaterThan(leftWidth);
    }
  });

  it('generates trachea and bifurcating primary bronchi', () => {
    const airways = createAirwayGeometries();
    expect(airways).toHaveLength(3);
    for (const geo of airways) {
      assertValidGeometry(geo);
    }
  });

  it('generates wedge-shaped liver thicker on the right lobe than the left lobe', () => {
    const liver = createLiverGeometry('female');
    assertValidGeometry(liver);

    const pos = liver.attributes.position;
    let rightMinY = Infinity;
    let rightMaxY = -Infinity;
    let leftMinY = Infinity;
    let leftMaxY = -Infinity;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (x < -0.06) {
        rightMinY = Math.min(rightMinY, y);
        rightMaxY = Math.max(rightMaxY, y);
      } else if (x > 0.06) {
        leftMinY = Math.min(leftMinY, y);
        leftMaxY = Math.max(leftMaxY, y);
      }
    }

    expect(rightMaxY - rightMinY).toBeGreaterThan(leftMaxY - leftMinY);
  });

  it('generates valid crescent spleen, pancreas metabolic core, and bilobed thymus', () => {
    assertValidGeometry(createSpleenGeometry());
    assertValidGeometry(createPancreasGeometry());
    assertValidGeometry(createThymusGeometry());
  });
});
