/**
 * ARGUS — live one-way light time to Earth (specs/01-data-schema.md §8, specs/02-ui-dashboard.md §6).
 *
 * Mars: Earth–Mars distance from the JPL "Approximate Positions of the Planets" Keplerian elements
 * (E. M. Standish, valid 1800–2050, error well under 1% of the distance here).
 * Moon: Earth–Moon distance from the main periodic terms of Meeus, Astronomical Algorithms ch. 47
 * (error ≈ a few hundred km, < 0.01 s of light time).
 * Light time = distance / c. Relay and ground-station processing time are not included.
 */

const C_KM_S = 299_792.458;
const AU_KM = 149_597_870.7;
const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;

/** Julian centuries since J2000.0 (TT ≈ UTC is fine at this accuracy). */
function centuriesSinceJ2000(date: Date): number {
  const jd = date.getTime() / MS_PER_DAY + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

interface Elements {
  a: [number, number];
  e: [number, number];
  I: [number, number];
  L: [number, number];
  peri: [number, number];
  node: [number, number];
}

// Standish Table 1 (1800–2050): value at J2000, rate per century. Units: au, rad-free, degrees.
const EARTH: Elements = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  I: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0.0, 0.0],
};
const MARS: Elements = {
  a: [1.52371034, 0.00001847],
  e: [0.0933941, 0.00007882],
  I: [1.84969142, -0.00813131],
  L: [-4.55343205, 19140.30268499],
  peri: [-23.94362959, 0.44441088],
  node: [49.55953891, -0.29257343],
};

/** Heliocentric ecliptic position (au). */
function heliocentric(el: Elements, T: number): [number, number, number] {
  const v = (k: [number, number]) => k[0] + k[1] * T;
  const a = v(el.a);
  const e = v(el.e);
  const I = v(el.I) * DEG;
  const L = v(el.L);
  const peri = v(el.peri);
  const node = v(el.node);
  const w = (peri - node) * DEG;
  let Mdeg = (L - peri) % 360;
  if (Mdeg > 180) Mdeg -= 360;
  if (Mdeg < -180) Mdeg += 360;
  const M = Mdeg * DEG;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const O = node * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Earth–Mars distance (km). */
export function earthMarsDistanceKm(date: Date): number {
  const T = centuriesSinceJ2000(date);
  const p = heliocentric(EARTH, T);
  const q = heliocentric(MARS, T);
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * AU_KM;
}

/** Earth–Moon centre distance (km), Meeus ch. 47 main terms. */
export function earthMoonDistanceKm(date: Date): number {
  const T = centuriesSinceJ2000(date);
  const D = (297.8501921 + 445267.1114034 * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const F = (93.272095 + 483202.0175233 * T) * DEG;
  // [D, M, M', F, Σr coefficient in 0.001 km] — Meeus table 47.A, largest terms.
  const terms: Array<[number, number, number, number, number]> = [
    [0, 0, 1, 0, -20905355],
    [2, 0, -1, 0, -3699111],
    [2, 0, 0, 0, -2955968],
    [0, 0, 2, 0, -569925],
    [0, 1, 0, 0, 48888],
    [0, 0, 0, 2, -3149],
    [2, 0, -2, 0, 246158],
    [2, -1, -1, 0, -152138],
    [2, 0, 1, 0, -170733],
    [2, -1, 0, 0, -204586],
    [0, 1, -1, 0, -129620],
    [1, 0, 0, 0, 108743],
    [0, 1, 1, 0, 104755],
    [2, 0, 0, -2, 10321],
    [0, 0, 1, -2, 79661],
    [4, 0, -1, 0, -34782],
    [0, 0, 3, 0, -23210],
    [4, 0, -2, 0, -21636],
    [2, 1, -1, 0, 24208],
    [2, 1, 0, 0, 30824],
    [1, 0, -1, 0, -8379],
    [1, 1, 0, 0, -16675],
    [2, -1, 1, 0, -12831],
    [2, 0, 2, 0, -10445],
    [4, 0, 0, 0, -11650],
    [2, 0, -3, 0, 14403],
    [0, 1, -2, 0, -7003],
    [2, -1, -2, 0, 10056],
  ];
  let sum = 0;
  for (const [d, m, mp, f, c] of terms) sum += c * Math.cos(d * D + m * M + mp * Mp + f * F);
  return 385000.56 + sum / 1000;
}

export const lightSeconds = (km: number) => km / C_KM_S;

/** Geostationary relay path for low Earth orbit (ISS → TDRS → ground ≈ 2 × 36,000 km). */
export const LEO_RELAY_KM = 72_000;
