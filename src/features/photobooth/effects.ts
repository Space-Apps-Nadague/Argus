/**
 * ARGUS — Photobooth effects (specs/02-ui-dashboard.md §2.7)
 * Everything is drawn on a canvas, procedurally (no image files): space backgrounds, colour
 * filters, a mission-camera data stamp, zero-g stickers and postcard frames.
 */

import type { SpaceLocationId } from '../../types/argus';
import type { PersonMask } from './vision';

export const STAGE_W = 960;
export const STAGE_H = 720;

export type BackgroundId = 'none' | 'mars' | 'moon' | 'earth' | 'cupola';
export type FilterId = 'none' | 'mars' | 'lunar' | 'night' | 'retro';
export type FrameId = 'none' | 'postcard' | 'polaroid';
export type StickerId = 'stamp' | 'patch' | 'float' | 'banner';

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: 'none', label: 'My room' },
  { id: 'mars', label: 'Mars' },
  { id: 'moon', label: 'Moon' },
  { id: 'earth', label: 'Earth from orbit' },
  { id: 'cupola', label: 'ISS cupola' },
];

export const FILTERS: { id: FilterId; label: string; css: string }[] = [
  { id: 'none', label: 'Natural', css: 'none' },
  { id: 'mars', label: 'Mars red', css: 'sepia(0.55) saturate(1.8) hue-rotate(-18deg) contrast(1.05)' },
  { id: 'lunar', label: 'Lunar grey', css: 'grayscale(1) contrast(1.2) brightness(1.05)' },
  { id: 'night', label: 'Night vision', css: 'grayscale(1) brightness(1.2) contrast(1.15)' },
  { id: 'retro', label: 'Retro film', css: 'sepia(0.4) saturate(0.85) contrast(1.15)' },
];

export const FRAMES: { id: FrameId; label: string }[] = [
  { id: 'none', label: 'No frame' },
  { id: 'postcard', label: 'Postcard' },
  { id: 'polaroid', label: 'Polaroid' },
];

export const STICKERS: { id: StickerId; label: string }[] = [
  { id: 'stamp', label: 'Mission data stamp' },
  { id: 'patch', label: 'Mission patch' },
  { id: 'float', label: 'Zero-g floaties' },
  { id: 'banner', label: '"Hi from…" banner' },
];

export interface BoothOptions {
  background: BackgroundId;
  filter: FilterId;
  frame: FrameId;
  stickers: StickerId[];
}

export interface BoothInfo {
  place: string;
  callsign: string;
  missionDay: number;
  /** e.g. "Sol 1043 · 15 Nov 2026". */
  dateLine: string;
  message: string;
  /** Mission-camera data stamp lines, e.g. ["2026-11-15 08:41:07 UTC", "MISSION DAY 214 · SOL 1043", …]. */
  stamp: string[];
}

/** Lines of the mission-camera data stamp (UTC time, mission day/sol, location, light time). */
export function stampLines(p: { now: Date; callsign: string; missionDay: number; sol?: number; location: string; lightTime: string }): string[] {
  const iso = p.now.toISOString();
  return [
    `ARGUS CAM · ${p.callsign.toUpperCase()}`,
    `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`,
    `MISSION DAY ${p.missionDay}${p.sol !== undefined ? ` · SOL ${p.sol}` : ''}`,
    `${p.location.toUpperCase()} · LIGHT TIME TO EARTH ${p.lightTime.toUpperCase()}`,
  ];
}

/** Friendly place name for captions. */
export function placeName(id: SpaceLocationId): string {
  switch (id) {
    case 'earth_pre':
    case 'earth_post':
      return 'Earth';
    case 'leo':
      return 'orbit';
    case 'gateway':
      return 'lunar orbit';
    case 'lunar_surface':
      return 'the Moon';
    case 'mars_transit':
      return 'deep space';
    default:
      return 'Mars';
  }
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Text on the postcard / polaroid. */
export function captionLines(info: BoothInfo): { title: string; meta: string; message: string } {
  return {
    title: `Greetings from ${capitalise(info.place)}!`,
    meta: `${info.callsign} · Mission day ${info.missionDay} · ${info.dateLine}`,
    message: info.message.trim(),
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.65})`;
    const s = r() < 0.08 ? 2.2 : 1.2;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

// ── backgrounds (cached per id) ─────────────────────────────────────────────

const bgCache = new Map<string, HTMLCanvasElement>();

function drawMars(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#c79a72');
  sky.addColorStop(1, '#e7b48a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,245,230,0.8)';
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.18, 16, 0, Math.PI * 2);
  ctx.fill();
  const layers = [
    { y: 0.52, c: '#b0603c', amp: 40 },
    { y: 0.62, c: '#9c4a2c', amp: 30 },
    { y: 0.74, c: '#843a22', amp: 18 },
  ];
  layers.forEach((l, i) => {
    const r = rng(11 + i);
    ctx.fillStyle = l.c;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 40) ctx.lineTo(x, h * l.y + Math.sin(x / (120 + i * 40) + i) * l.amp + r() * 10);
    ctx.lineTo(w, h);
    ctx.fill();
  });
  const r = rng(5);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(60,25,15,${0.3 + r() * 0.4})`;
    const y = h * (0.8 + r() * 0.2);
    ctx.beginPath();
    ctx.ellipse(r() * w, y, 4 + r() * 18, 2 + r() * 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMoon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#02040a';
  ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h * 0.65, 260, 3);
  const ex = w * 0.22;
  const ey = h * 0.2;
  const er = 46;
  const g = ctx.createRadialGradient(ex - 14, ey - 14, 6, ex, ey, er);
  g.addColorStop(0, '#9fd3ff');
  g.addColorStop(0.6, '#2c6fc9');
  g.addColorStop(1, '#0d2a5a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(ex + 8, ey - 6, 22, 7, -0.4, 0, Math.PI * 2);
  ctx.fill();
  const ground = ctx.createLinearGradient(0, h * 0.6, 0, h);
  ground.addColorStop(0, '#8d8d8d');
  ground.addColorStop(1, '#4b4b4b');
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 30) ctx.lineTo(x, h * 0.62 + Math.sin(x / 140) * 14);
  ctx.lineTo(w, h);
  ctx.fill();
  const r = rng(9);
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = h * (0.7 + r() * 0.28);
    const rx = 10 + r() * 46;
    ctx.fillStyle = 'rgba(40,40,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 1, rx, rx * 0.32, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
}

function drawEarthFromOrbit(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#01030a';
  ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h * 0.6, 220, 7);
  const cx = w * 0.5;
  const cy = h * 1.75;
  const R = h * 1.25;
  const glow = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.06);
  glow.addColorStop(0, 'rgba(120,190,255,0.9)');
  glow.addColorStop(1, 'rgba(120,190,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
  ctx.fill();
  const sea = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.9, R * 0.1, cx, cy, R);
  sea.addColorStop(0, '#3d8ee8');
  sea.addColorStop(1, '#0a2f6b');
  ctx.fillStyle = sea;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const r = rng(21);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = 'rgba(92,140,70,0.75)';
    ctx.beginPath();
    ctx.ellipse(r() * w, h * (0.55 + r() * 0.5), 40 + r() * 120, 18 + r() * 40, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(r() * w, h * (0.5 + r() * 0.5), 30 + r() * 140, 6 + r() * 16, r() * 0.6 - 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCupola(ctx: CanvasRenderingContext2D, w: number, h: number) {
  drawEarthFromOrbit(ctx, w, h);
  // ISS cupola seen from inside: a round top window ringed by six side windows in a grey frame.
  const cx = w / 2;
  const cy = h * 0.5;
  const centre = h * 0.27;
  const ring = h * 0.47;
  const side = h * 0.15;
  const windows: [number, number, number][] = [[cx, cy, centre]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    windows.push([cx + Math.cos(a) * ring * 1.25, cy + Math.sin(a) * ring, side]);
  }
  ctx.save();
  const panel = ctx.createLinearGradient(0, 0, 0, h);
  panel.addColorStop(0, '#d7dce3');
  panel.addColorStop(1, '#9aa3ae');
  ctx.fillStyle = panel;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  for (const [x, y, r] of windows) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill('evenodd');
  ctx.strokeStyle = '#6b7480';
  for (const [x, y, r] of windows) {
    ctx.lineWidth = r === centre ? 16 : 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Handrails.
  ctx.strokeStyle = '#e8b04a';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.06, h * 0.9);
  ctx.lineTo(w * 0.26, h * 0.9);
  ctx.moveTo(w * 0.74, h * 0.9);
  ctx.lineTo(w * 0.94, h * 0.9);
  ctx.stroke();
  ctx.restore();
}

export function backgroundCanvas(id: BackgroundId, w = STAGE_W, h = STAGE_H): HTMLCanvasElement | null {
  if (id === 'none') return null;
  const key = `${id}:${w}x${h}`;
  let c = bgCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    if (id === 'mars') drawMars(ctx, w, h);
    else if (id === 'moon') drawMoon(ctx, w, h);
    else if (id === 'earth') drawEarthFromOrbit(ctx, w, h);
    else drawCupola(ctx, w, h);
    bgCache.set(key, c);
  }
  return c;
}

// ── compositing ─────────────────────────────────────────────────────────────

/** "Cover" fit of the video into the stage: scale and offsets. */
export function coverFit(vw: number, vh: number, w = STAGE_W, h = STAGE_H) {
  const s = Math.max(w / vw, h / vh);
  return { s, ox: (w - vw * s) / 2, oy: (h - vh * s) / 2 };
}

export class BoothRenderer {
  private scene = makeCanvas(STAGE_W, STAGE_H);
  private person = makeCanvas(STAGE_W, STAGE_H);
  private maskCanvas = makeCanvas(1, 1);
  private maskImage: ImageData | null = null;

  /** Draws one frame. */
  render(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    mask: PersonMask | null,
    opts: BoothOptions,
    info: BoothInfo,
    t: number
  ) {
    const W = STAGE_W;
    const H = STAGE_H;
    const vw = video.videoWidth || W;
    const vh = video.videoHeight || H;
    const { s, ox, oy } = coverFit(vw, vh);
    const sc = this.scene.getContext('2d')!;
    sc.clearRect(0, 0, W, H);

    const drawMirrored = (c: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number) => {
      c.save();
      c.translate(W, 0);
      c.scale(-1, 1);
      c.drawImage(img, ox, oy, iw * s * (vw / iw), ih * s * (vh / ih));
      c.restore();
    };

    const bg = backgroundCanvas(opts.background);
    if (bg && mask) {
      sc.drawImage(bg, 0, 0, W, H);
      this.updateMask(mask);
      const pc = this.person.getContext('2d')!;
      pc.globalCompositeOperation = 'source-over';
      pc.clearRect(0, 0, W, H);
      drawMirrored(pc, video, vw, vh);
      pc.globalCompositeOperation = 'destination-in';
      drawMirrored(pc, this.maskCanvas, mask.width, mask.height);
      pc.globalCompositeOperation = 'source-over';
      sc.drawImage(this.person, 0, 0);
    } else {
      drawMirrored(sc, video, vw, vh);
    }

    // Filter the photo layer only; stickers and frames keep their colours.
    const filter = FILTERS.find((f) => f.id === opts.filter) ?? FILTERS[0];
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.filter = filter.css;
    ctx.drawImage(this.scene, 0, 0);
    ctx.filter = 'none';
    if (opts.filter === 'night') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(90,255,120)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    }
    if (opts.filter === 'retro') {
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(40,20,0,0.55)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    if (opts.stickers.includes('float')) drawFloaties(ctx, t);
    // Keep the patch inside the frame and clear of the viewfinder corners.
    const inset = opts.frame === 'postcard' ? 22 : opts.frame === 'polaroid' ? 30 : 0;
    if (opts.stickers.includes('patch')) drawPatch(ctx, W - inset - 104, inset + 104, info);
    if (opts.stickers.includes('banner') && opts.frame === 'none') drawBanner(ctx, `Hi from ${info.place}!`, 28, opts.stickers.includes('stamp') ? 40 : H - 86);
    if (opts.stickers.includes('stamp')) drawStamp(ctx, info.stamp, opts.frame);
    if (opts.frame !== 'none') drawFrame(ctx, opts.frame, info);
  }

  private updateMask(mask: PersonMask) {
    if (this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height || !this.maskImage) {
      this.maskCanvas.width = mask.width;
      this.maskCanvas.height = mask.height;
      this.maskImage = new ImageData(mask.width, mask.height);
    }
    const px = this.maskImage.data;
    for (let i = 0; i < mask.data.length; i++) {
      const a = Math.min(1, Math.max(0, (mask.data[i] - 0.35) / 0.35));
      px[i * 4] = 255;
      px[i * 4 + 1] = 255;
      px[i * 4 + 2] = 255;
      px[i * 4 + 3] = a * 255;
    }
    this.maskCanvas.getContext('2d')!.putImageData(this.maskImage, 0, 0);
  }
}

// ── stickers & frames ───────────────────────────────────────────────────────

/** Mission-camera look: viewfinder corner brackets and a monospace data block, like a real crew camera. */
function drawStamp(ctx: CanvasRenderingContext2D, lines: string[], frame: FrameId) {
  const W = STAGE_W;
  // Keep the stamp inside the photo area of the frame.
  const bottom = frame === 'postcard' ? STAGE_H - 118 : frame === 'polaroid' ? STAGE_H - 128 : STAGE_H;
  const inset = frame === 'none' ? 0 : frame === 'postcard' ? 22 : 30;
  const left = inset + 26;
  const right = W - inset - 26;
  const top = inset + 26;
  const low = bottom - 26;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  const arm = 34;
  ([[left, top, 1, 1], [right, top, -1, 1], [left, low, 1, -1], [right, low, -1, -1]] as const).forEach(([x, y, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * arm);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * arm, y);
    ctx.stroke();
  });
  ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'top';
  const lh = 21;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
  const boxH = lines.length * lh + 16;
  const bx = left + 10;
  const by = low - 10 - boxH;
  ctx.fillStyle = 'rgba(4,10,20,0.55)';
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.fillStyle = '#e8f6ff';
  lines.forEach((l, i) => {
    if (i === 0) {
      ctx.fillStyle = '#ff4d5e';
      ctx.beginPath();
      ctx.arc(bx + 14, by + 8 + lh / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4dd0ff';
      ctx.fillText(l, bx + 24, by + 8);
      ctx.fillStyle = '#e8f6ff';
    } else {
      ctx.fillText(l, bx + 12, by + 8 + i * lh);
    }
  });
  ctx.restore();
}

function drawPatch(ctx: CanvasRenderingContext2D, x: number, y: number, info: BoothInfo) {
  const r = 62;
  ctx.save();
  const g = ctx.createRadialGradient(x - 20, y - 20, 10, x, y, r);
  g.addColorStop(0, '#2a4f9e');
  g.addColorStop(1, '#0c1d45');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e8edf2';
  ctx.stroke();
  ctx.fillStyle = '#d9473b';
  ctx.beginPath();
  ctx.arc(x + 18, y + 14, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 46, 14, -0.35, 0, Math.PI * 2);
  ctx.stroke();
  star(ctx, x - 22, y - 16, 9, '#ffd75e');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px Orbitron, Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ARGUS', x, y - 34);
  ctx.font = 'bold 11px Inter, sans-serif';
  ctx.fillText(info.callsign.toUpperCase().slice(0, 12), x, y + 46);
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Zero-g floaties: stars, water bubbles, a tiny planet and a bolt drifting slowly. */
function drawFloaties(ctx: CanvasRenderingContext2D, t: number) {
  const items = [
    { kind: 'star', x: 0.12, y: 0.22, s: 16, c: '#ffd75e' },
    { kind: 'bubble', x: 0.85, y: 0.55, s: 18, c: '' },
    { kind: 'planet', x: 0.18, y: 0.7, s: 22, c: '#e07a5f' },
    { kind: 'bubble', x: 0.7, y: 0.18, s: 11, c: '' },
    { kind: 'star', x: 0.9, y: 0.82, s: 12, c: '#9ee7ff' },
    { kind: 'bolt', x: 0.32, y: 0.12, s: 16, c: '#c9d2dc' },
  ];
  items.forEach((it, i) => {
    const x = it.x * STAGE_W + Math.sin(t * 0.0006 + i * 1.7) * 18;
    const y = it.y * STAGE_H + Math.cos(t * 0.0005 + i * 2.3) * 14;
    const a = t * 0.0004 * (i % 2 ? 1 : -1) + i;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    if (it.kind === 'star') star(ctx, 0, 0, it.s, it.c);
    else if (it.kind === 'bubble') {
      ctx.strokeStyle = 'rgba(180,230,255,0.9)';
      ctx.fillStyle = 'rgba(120,200,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, it.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(-it.s * 0.35, -it.s * 0.35, it.s * 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (it.kind === 'planet') {
      ctx.fillStyle = it.c;
      ctx.beginPath();
      ctx.arc(0, 0, it.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f4d35e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, it.s * 1.7, it.s * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = it.c;
      ctx.fillRect(-it.s * 0.18, -it.s, it.s * 0.36, it.s * 2);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(ang) * it.s * 0.55, -it.s + Math.sin(ang) * it.s * 0.55);
      }
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.save();
  ctx.font = 'bold 34px Orbitron, Inter, sans-serif';
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = 'rgba(8,16,32,0.75)';
  roundRect(ctx, x, y - 6, w, 58, 29);
  ctx.fill();
  ctx.strokeStyle = '#4dd0ff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 22, y + 23);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFrame(ctx: CanvasRenderingContext2D, frame: FrameId, info: BoothInfo) {
  const W = STAGE_W;
  const H = STAGE_H;
  const { title, meta, message } = captionLines(info);
  ctx.save();
  if (frame === 'postcard') {
    const band = 118;
    ctx.fillStyle = '#fbf7ef';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(22, 22, W - 44, H - band - 22);
    ctx.fill('evenodd');
    ctx.fillStyle = '#c0392b';
    ctx.font = 'bold 36px Orbitron, Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 30, H - band + 14);
    ctx.fillStyle = '#334155';
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText(meta, 32, H - band + 60);
    if (message) {
      ctx.font = 'italic 18px Inter, sans-serif';
      ctx.fillText(`"${message.slice(0, 80)}"`, 32, H - band + 84);
    }
    // Stamp.
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeRect(W - 118, H - band + 14, 88, 90);
    ctx.setLineDash([]);
    ctx.fillStyle = '#0c1d45';
    ctx.fillRect(W - 112, H - band + 20, 76, 78);
    ctx.fillStyle = '#e07a5f';
    ctx.beginPath();
    ctx.arc(W - 74, H - band + 58, 22, 0, Math.PI * 2);
    ctx.fill();
    star(ctx, W - 98, H - band + 34, 7, '#ffd75e');
  } else {
    const side = 30;
    const bottom = 128;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(side, side, W - side * 2, H - side - bottom);
    ctx.fill('evenodd');
    ctx.fillStyle = '#1f2937';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'italic bold 32px "Segoe Print", "Comic Sans MS", cursive';
    ctx.fillText(message ? message.slice(0, 48) : title, W / 2, H - bottom + 22);
    ctx.font = '15px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(meta, W / 2, H - bottom + 76);
  }
  ctx.restore();
}
