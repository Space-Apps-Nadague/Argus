/**
 * ARGUS — Photobooth tab (specs/02-ui-dashboard.md §2.7)
 * A fun camera booth for the crew: space backgrounds, an astronaut helmet that follows the face,
 * zero-g stickers, colour filters and postcard frames. Close your hand (fist) → 3-second timer →
 * photo. Photos go home through the Earth downlink queue and arrive after the live light time.
 * Camera frames are processed on this device only.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Download, Grab, Heart, Mail, RotateCcw, Send, Trash2, UserPlus, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { commDelayAt, formatCommDelay, marsTime } from '../data/spaceLocations';
import { Card } from './ui/Card';
import {
  BACKGROUNDS,
  BoothRenderer,
  faceToStage,
  FILTERS,
  FRAMES,
  placeName,
  STAGE_H,
  STAGE_W,
  STICKERS,
  type BoothInfo,
  type BoothOptions,
  type StickerId,
} from '../features/photobooth/effects';
import { analyseFrame, loadVision, type FaceBox, type PersonMask, type VisionModels } from '../features/photobooth/vision';
import { IDLE, startCountdown, stepShutter, type ShutterState } from '../features/photobooth/gesture';
import {
  deliveryStatus,
  formatCountdown,
  loadContacts,
  loadPostcards,
  newPostcard,
  saveContacts,
  savePostcard,
  type FamilyContact,
  type FamilyPostcard,
} from '../features/photobooth/familyMail';

type CameraState = 'starting' | 'ready' | 'error';

function shutterSound() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const len = Math.floor(ac.sampleRate * 0.08);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start();
    src.onended = () => void ac.close();
  } catch {
    /* no sound */
  }
}

/** JPEG data URL of the stage, downscaled for sending and storage. */
function snapshot(canvas: HTMLCanvasElement, maxW = 800): string {
  const scale = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`hud-focus rounded-full border px-3 py-1 text-xs transition-colors ${
      active ? 'border-hud-accent bg-hud-accent/20 text-hud-text' : 'border-hud-line text-hud-muted hover:text-hud-text'
    }`}
  >
    {children}
  </button>
);

export const PhotoboothTab: React.FC = () => {
  const { activeCrewMember, spaceLocation, latestDay } = useMission();
  const crewId = activeCrewMember.id;
  const place = placeName(spaceLocation.id);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraError, setCameraError] = useState('');
  const [models, setModels] = useState<VisionModels | null>(null);
  const [modelsError, setModelsError] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const [opts, setOpts] = useState<BoothOptions>({ background: 'none', filter: 'none', frame: 'none', stickers: ['helmet', 'float'] });
  const [message, setMessage] = useState('');
  const [contacts, setContacts] = useState<FamilyContact[]>(() => loadContacts(crewId));
  const [selectedTo, setSelectedTo] = useState<string[]>([]);
  const [postcards, setPostcards] = useState<FamilyPostcard[]>(() => loadPostcards(crewId));
  const [newName, setNewName] = useState('');
  const [newRelation, setNewRelation] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setContacts(loadContacts(crewId));
    setPostcards(loadPostcards(crewId));
  }, [crewId]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const info: BoothInfo = useMemo(() => {
    const d = new Date();
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const sol = spaceLocation.clock === 'mars' ? `Sol ${marsTime(d).sol} · ` : '';
    return { place, callsign: activeCrewMember.callsign, missionDay: latestDay, dateLine: `${sol}${date}`, message };
  }, [place, activeCrewMember.callsign, latestDay, message, spaceLocation.clock]);

  // Latest values for the animation loop without restarting it.
  const live = useRef({ opts, info });
  live.current = { opts, info };
  const shutter = useRef<ShutterState>(IDLE);
  const takePhotoRef = useRef<() => void>(() => undefined);

  takePhotoRef.current = () => {
    const c = canvasRef.current;
    if (!c) return;
    shutterSound();
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setPhoto(snapshot(c));
    setSelectedTo(contacts.map((x) => x.name));
  };

  // Camera.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      if (cancelled) return;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setCamera('ready');
    })().catch((err: unknown) => {
      if (cancelled) return;
      setCamera('error');
      setCameraError(err instanceof Error && err.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'Camera not available.');
    });
    loadVision()
      .then((m) => !cancelled && setModels(m))
      .catch(() => !cancelled && setModelsError(true));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Render + analysis loop.
  useEffect(() => {
    if (camera !== 'ready') return;
    const renderer = new BoothRenderer();
    let raf = 0;
    let frame = 0;
    let mask: PersonMask | null = null;
    let face: FaceBox | null = null;
    let fist = false;
    let lastTs = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2) return;
      const { opts: o, info: inf } = live.current;
      frame++;
      if (models) {
        const ts = Math.max(lastTs + 1, Math.round(t));
        lastTs = ts;
        try {
          const r = analyseFrame(models, v, ts, {
            mask: o.background !== 'none',
            gesture: frame % 3 === 0,
            face: o.stickers.includes('helmet') && frame % 2 === 0,
          });
          if (r.mask) mask = r.mask;
          if (r.fist !== undefined) fist = r.fist;
          if (r.face !== undefined) {
            const f = r.face ? faceToStage(r.face, v.videoWidth, v.videoHeight) : null;
            // Smooth the helmet so it does not jitter.
            face = f && face ? { x: face.x + (f.x - face.x) * 0.5, y: face.y + (f.y - face.y) * 0.5, width: face.width + (f.width - face.width) * 0.5, height: face.height + (f.height - face.height) * 0.5 } : f;
          }
        } catch {
          /* skip this frame */
        }
      }
      renderer.render(c.getContext('2d')!, v, o.background !== 'none' ? mask : null, face, o, inf, t);
      const step = stepShutter(shutter.current, fist, t);
      shutter.current = step.state;
      setCountdown((prev) => (prev === step.secondsLeft ? prev : step.secondsLeft));
      if (step.capture) takePhotoRef.current();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera, models]);

  const startTimer = () => {
    shutter.current = startCountdown(performance.now());
  };

  const toggleSticker = (id: StickerId) =>
    setOpts((o) => ({ ...o, stickers: o.stickers.includes(id) ? o.stickers.filter((s) => s !== id) : [...o.stickers, id] }));

  const delay = commDelayAt(spaceLocation, now).seconds;

  const send = useCallback(() => {
    if (!photo) return;
    const card = newPostcard({ crewId, to: selectedTo, message, image: photo, delaySeconds: delay });
    setPostcards(savePostcard(card));
    setPhoto(null);
  }, [photo, crewId, selectedTo, message, delay]);

  const addContact = () => {
    const name = newName.trim();
    if (!name) return;
    const next = [...contacts, { id: `fc-${Date.now()}`, name: name.slice(0, 40), relation: newRelation.trim().slice(0, 30) }];
    setContacts(next);
    saveContacts(crewId, next);
    setNewName('');
    setNewRelation('');
  };
  const removeContact = (id: string) => {
    const next = contacts.filter((c) => c.id !== id);
    setContacts(next);
    saveContacts(crewId, next);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card title="Photobooth" icon={<Camera className="h-4 w-4" />}>
          <div className="relative overflow-hidden rounded-xl border border-hud-line bg-black" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
            <video ref={videoRef} muted playsInline className="hidden" />
            <canvas ref={canvasRef} width={STAGE_W} height={STAGE_H} className="h-full w-full" aria-label="Live photobooth preview" />
            {camera !== 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-hud-muted" role="status">
                {camera === 'starting' ? 'Starting camera…' : `${cameraError} Allow the camera in your browser to use the photobooth.`}
              </div>
            )}
            {countdown !== null && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="assertive">
                <span className="font-display text-[10rem] font-bold leading-none text-white drop-shadow-[0_0_30px_rgba(77,208,255,0.9)]">{countdown}</span>
              </div>
            )}
            {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={startTimer} disabled={camera !== 'ready'} className="hud-btn-primary">
              <Camera className="h-4 w-4" aria-hidden="true" />
              Take photo (3 s)
            </button>
            <p className="flex items-center gap-1.5 text-xs text-hud-muted">
              <Grab className="h-4 w-4 text-hud-accent" aria-hidden="true" />
              {models
                ? 'Or close your hand into a fist: the 3-second timer starts by itself.'
                : modelsError
                  ? 'Effects could not load; the plain camera still works.'
                  : 'Loading hand, face and background effects…'}
            </p>
          </div>
        </Card>

        <Card title="Effects" bodyClassName="p-4 space-y-4">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Background</h3>
            <div className="flex flex-wrap gap-1.5">
              {BACKGROUNDS.map((b) => (
                <Chip key={b.id} active={opts.background === b.id} onClick={() => setOpts((o) => ({ ...o, background: b.id }))}>
                  {b.label}
                </Chip>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Helmet &amp; stickers</h3>
            <div className="flex flex-wrap gap-1.5">
              {STICKERS.map((s) => (
                <Chip key={s.id} active={opts.stickers.includes(s.id)} onClick={() => toggleSticker(s.id)}>
                  {s.id === 'banner' ? `"Hi from ${place}!"` : s.label}
                </Chip>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Colour filter</h3>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <Chip key={f.id} active={opts.filter === f.id} onClick={() => setOpts((o) => ({ ...o, filter: f.id }))}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Frame</h3>
            <div className="flex flex-wrap gap-1.5">
              {FRAMES.map((f) => (
                <Chip key={f.id} active={opts.frame === f.id} onClick={() => setOpts((o) => ({ ...o, frame: f.id }))}>
                  {f.label}
                </Chip>
              ))}
            </div>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-hud-muted">Message on the photo</span>
              <input
                className="hud-input"
                value={message}
                maxLength={80}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Miss you! Look at this view"
              />
            </label>
          </section>
        </Card>
      </div>

      {photo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="photo-title">
          <div className="hud-card w-full max-w-2xl space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 id="photo-title" className="font-display text-sm font-bold tracking-wider">
                YOUR PHOTO
              </h2>
              <button type="button" onClick={() => setPhoto(null)} className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <img src={photo} alt="Photo just taken in the photobooth" className="w-full rounded-lg border border-hud-line" />
            <fieldset>
              <legend className="mb-1 text-xs text-hud-muted">Send to</legend>
              {contacts.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {contacts.map((c) => (
                    <Chip
                      key={c.id}
                      active={selectedTo.includes(c.name)}
                      onClick={() => setSelectedTo((s) => (s.includes(c.name) ? s.filter((n) => n !== c.name) : [...s, c.name]))}
                    >
                      {c.name}
                      {c.relation ? ` · ${c.relation}` : ''}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-hud-muted">Add family members below to send photos home.</p>
              )}
            </fieldset>
            <p className="text-xs text-hud-muted">
              Arrives on Earth in <span className="font-mono text-amber-300">{formatCommDelay(spaceLocation, now)}</span> (one-way light time).
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={send} disabled={!selectedTo.length} className="hud-btn-primary">
                <Send className="h-4 w-4" aria-hidden="true" />
                Send to family
              </button>
              <a href={photo} download={`argus-${activeCrewMember.callsign.toLowerCase()}-${Date.now()}.jpg`} className="hud-btn">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </a>
              <button type="button" onClick={() => setPhoto(null)} className="hud-btn">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Retake
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Card title="Family mail" icon={<Mail className="h-4 w-4" />}>
          {postcards.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {postcards.map((p) => {
                const st = deliveryStatus(p, now);
                return (
                  <li key={p.id} className="overflow-hidden rounded-lg border border-hud-line bg-hud-panel/60">
                    <img src={p.image} alt={`Photo sent to ${p.to.join(', ')}`} className="aspect-[4/3] w-full object-cover" />
                    <div className="space-y-0.5 p-2 text-xs">
                      <p className="text-hud-text">To {p.to.join(', ')}</p>
                      {p.message && <p className="truncate italic text-hud-muted">"{p.message}"</p>}
                      <p className={st.delivered ? 'text-emerald-300' : 'text-amber-300'}>
                        {st.delivered
                          ? `Delivered ${new Date(p.arrivesAtIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : `On its way · arrives in ${formatCountdown(st.secondsLeft)}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-hud-muted">No photos sent yet. Take one and send it home.</p>
          )}
        </Card>

        <Card title="Family" icon={<Heart className="h-4 w-4" />}>
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md bg-hud-panel/60 px-2 py-1.5 text-sm">
                <span>
                  {c.name}
                  {c.relation && <span className="text-hud-muted"> · {c.relation}</span>}
                </span>
                <button type="button" onClick={() => removeContact(c.id)} className="hud-focus rounded p-1 text-hud-muted hover:text-red-300" aria-label={`Remove ${c.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addContact();
            }}
          >
            <input className="hud-input min-w-0 flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="Family member name" />
            <input className="hud-input w-28" value={newRelation} onChange={(e) => setNewRelation(e.target.value)} placeholder="e.g. daughter" aria-label="Relation" />
            <button type="submit" className="hud-btn" disabled={!newName.trim()}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add
            </button>
          </form>
          <p className="mt-2 text-[11px] text-hud-muted">Photos and family details stay on this device. Camera frames are never uploaded.</p>
        </Card>
      </div>
    </div>
  );
};
