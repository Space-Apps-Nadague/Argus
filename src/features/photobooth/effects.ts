/**
 * ARGUS — Photobooth effects (specs/02-ui-dashboard.md §2.7)
 * Everything is drawn on a canvas, procedurally (no image files): colour filters, a mission-camera
 * data stamp, zero-g stickers, postcard frames and the 4-photo strip. The real background stays:
 * no fake scenery behind the crew member.
 */

import type { SpaceLocationId } from '../../types/argus';

export const STAGE_W = 960;
export const STAGE_H = 720;

export type FilterId = 'none' | 'mars' | 'lunar' | 'night' | 'retro';
export type FrameId = 'none' | 'postcard' | 'polaroid';
export type StickerId = 'stamp' | 'patch' | 'float' | 'banner';

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

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
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

  /** Draws one frame: the mirrored camera (real background), filter, overlays and frame. */
  render(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, opts: BoothOptions, info: BoothInfo, t: number) {
    const W = STAGE_W;
    const H = STAGE_H;
    const vw = video.videoWidth || W;
    const vh = video.videoHeight || H;
    const { s, ox, oy } = coverFit(vw, vh);
    const sc = this.scene.getContext('2d')!;
    sc.clearRect(0, 0, W, H);
    sc.save();
    sc.translate(W, 0);
    sc.scale(-1, 1);
    sc.drawImage(video, ox, oy, vw * s, vh * s);
    sc.restore();

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

// ── 4-photo strip ───────────────────────────────────────────────────────────

const STRIP = { photoW: 560, photoH: 420, pad: 22, gap: 14, caption: 118 };

/** Classic photobooth strip: the photos stacked on a cream card with the mission caption at the bottom. */
export function composeStrip(photos: CanvasImageSource[], info: BoothInfo): HTMLCanvasElement {
  const { photoW, photoH, pad, gap, caption } = STRIP;
  const n = Math.max(1, photos.length);
  const W = photoW + pad * 2;
  const H = pad + n * photoH + (n - 1) * gap + caption;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbf7ef';
  ctx.fillRect(0, 0, W, H);
  photos.forEach((p, i) => {
    const y = pad + i * (photoH + gap);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(pad, y, photoW, photoH);
    // Each photo is a full stage frame (4:3), same aspect as the slot.
    ctx.drawImage(p, pad, y, photoW, photoH);
  });
  const { title, meta, message } = captionLines(info);
  const top = H - caption;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#c0392b';
  ctx.font = 'bold 30px Orbitron, Inter, sans-serif';
  ctx.fillText(title, W / 2, top + 16, W - pad * 2);
  ctx.fillStyle = '#334155';
  ctx.font = '15px Inter, sans-serif';
  ctx.fillText(meta, W / 2, top + 56, W - pad * 2);
  if (message) {
    ctx.font = 'italic 17px Inter, sans-serif';
    ctx.fillText(`"${message.slice(0, 60)}"`, W / 2, top + 80, W - pad * 2);
  }
  return c;
}
