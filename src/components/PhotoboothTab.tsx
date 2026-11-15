/**
 * ARGUS — Photobooth tab (specs/02-ui-dashboard.md §2.7)
 * A camera booth for the crew: space backgrounds, a mission-camera data stamp, zero-g stickers,
 * colour filters and postcard frames. Close your hand (fist) → 3-second timer → photo. Photos land
 * in a strip under the camera (the camera keeps running) and go home through the Earth downlink
 * queue, arriving after the live light time. Camera frames are processed on this device only.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Download, Grab, Heart, Mail, Send, Trash2, UserPlus, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { commDelayAt, formatCommDelay, marsTime } from '../data/spaceLocations';
import { Card } from './ui/Card';
import {
  BACKGROUNDS,
  BoothRenderer,
  FILTERS,
  FRAMES,
  placeName,
  STAGE_H,
  STAGE_W,
  stampLines,
  STICKERS,
  type BoothInfo,
  type BoothOptions,
  type StickerId,
} from '../features/photobooth/effects';
import { analyseFrame, loadVision, type PersonMask, type VisionModels } from '../features/photobooth/vision';
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

interface Shot {
  id: string;
  image: string;
  sentTo?: string[];
}

/** Photos kept in the strip for this session. */
const MAX_SHOTS = 8;

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

/** Small form to add a family member (used in the Family card and inside a photo's Send box). */
const AddContactForm: React.FC<{ onAdd: (name: string, relation: string) => void; compact?: boolean }> = ({ onAdd, compact }) => {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), relation.trim());
        setName('');
        setRelation('');
      }}
    >
      <input className="hud-input min-w-0 flex-1 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Family member name" />
      <input className={`hud-input text-xs ${compact ? 'w-24' : 'w-28'}`} value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="e.g. daughter" aria-label="Relation" />
      <button type="submit" className="hud-btn text-xs" disabled={!name.trim()}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Add
      </button>
    </form>
  );
};

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

  const [opts, setOpts] = useState<BoothOptions>({ background: 'none', filter: 'none', frame: 'none', stickers: ['stamp', 'patch'] });
  const [message, setMessage] = useState('');
  const [contacts, setContacts] = useState<FamilyContact[]>(() => loadContacts(crewId));
  const [postcards, setPostcards] = useState<FamilyPostcard[]>(() => loadPostcards(crewId));
  const [shots, setShots] = useState<Shot[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState<string[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setContacts(loadContacts(crewId));
    setPostcards(loadPostcards(crewId));
    setShots([]);
  }, [crewId]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const lightTime = formatCommDelay(spaceLocation, now);
  const info: BoothInfo = useMemo(() => {
    const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const sol = spaceLocation.clock === 'mars' ? marsTime(now).sol : undefined;
    return {
      place,
      callsign: activeCrewMember.callsign,
      missionDay: latestDay,
      dateLine: `${sol !== undefined ? `Sol ${sol} · ` : ''}${date}`,
      message,
      stamp: stampLines({ now, callsign: activeCrewMember.callsign, missionDay: latestDay, sol, location: spaceLocation.label, lightTime }),
    };
  }, [place, activeCrewMember.callsign, latestDay, message, spaceLocation, now, lightTime]);

  // Latest values for the animation loop without restarting it.
  const live = useRef({ opts, info });
  live.current = { opts, info };
  const shutter = useRef<ShutterState>(IDLE);

  const takePhoto = useRef<() => void>(() => undefined);
  takePhoto.current = () => {
    const c = canvasRef.current;
    if (!c) return;
    shutterSound();
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const shot: Shot = { id: `shot-${Date.now()}`, image: snapshot(c) };
    setShots((s) => [shot, ...s].slice(0, MAX_SHOTS));
  };

  // Camera + models.
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
          const r = analyseFrame(models, v, ts, { mask: o.background !== 'none', gesture: frame % 3 === 0 });
          if (r.mask) mask = r.mask;
          if (r.fist !== undefined) fist = r.fist;
        } catch {
          /* skip this frame */
        }
      }
      renderer.render(c.getContext('2d')!, v, o.background !== 'none' ? mask : null, o, inf, t);
      const step = stepShutter(shutter.current, fist, t);
      shutter.current = step.state;
      setCountdown((prev) => (prev === step.secondsLeft ? prev : step.secondsLeft));
      if (step.capture) takePhoto.current();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera, models]);

  const startTimer = () => {
    shutter.current = startCountdown(performance.now());
  };

  const toggleSticker = (id: StickerId) =>
    setOpts((o) => ({ ...o, stickers: o.stickers.includes(id) ? o.stickers.filter((s) => s !== id) : [...o.stickers, id] }));

  const addContact = (name: string, relation: string, selectForSending = false) => {
    const next = [...contacts, { id: `fc-${Date.now()}`, name: name.slice(0, 40), relation: relation.slice(0, 30) }];
    setContacts(next);
    saveContacts(crewId, next);
    if (selectForSending) setSendTo((s) => [...s, name.slice(0, 40)]);
  };
  const removeContact = (id: string) => {
    const next = contacts.filter((c) => c.id !== id);
    setContacts(next);
    saveContacts(crewId, next);
  };

  const openSend = (id: string) => {
    setSending((cur) => (cur === id ? null : id));
    setSendTo(contacts.map((c) => c.name));
  };
  const send = (shot: Shot) => {
    if (!sendTo.length) return;
    const delay = commDelayAt(spaceLocation, new Date()).seconds;
    setPostcards(savePostcard(newPostcard({ crewId, to: sendTo, message, image: shot.image, delaySeconds: delay })));
    setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, sentTo: sendTo } : x)));
    setSending(null);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card title="Photobooth" icon={<Camera className="h-4 w-4" />}>
          <div className="relative mx-auto max-h-[62vh] overflow-hidden rounded-xl border border-hud-line bg-black" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
            <video ref={videoRef} muted playsInline className="hidden" />
            <canvas ref={canvasRef} width={STAGE_W} height={STAGE_H} className="h-full w-full" aria-label="Live photobooth preview" />
            {camera !== 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-hud-muted" role="status">
                {camera === 'starting' ? 'Starting camera…' : `${cameraError} Allow the camera in your browser to use the photobooth.`}
              </div>
            )}
            {countdown !== null && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="assertive">
                <span className="font-display text-[9rem] font-bold leading-none text-white drop-shadow-[0_0_30px_rgba(77,208,255,0.9)]">{countdown}</span>
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
                  : 'Loading hand and background effects…'}
            </p>
          </div>

          {/* Photo strip: the camera keeps running; each photo can be sent, downloaded or deleted. */}
          <section aria-label="Photos taken" className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-hud-muted">
              Photos {shots.length ? `(${shots.length})` : ''}
            </h3>
            {shots.length === 0 ? (
              <p className="text-xs text-hud-muted">Your photos appear here. Keep shooting as many as you like.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shots.map((shot) => (
                  <li key={shot.id} className="overflow-hidden rounded-lg border border-hud-line bg-hud-panel/60">
                    <button type="button" onClick={() => setViewing(shot.image)} className="hud-focus block w-full" aria-label="View photo larger">
                      <img src={shot.image} alt="Photo taken in the photobooth" className="aspect-[4/3] w-full object-cover" />
                    </button>
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      {shot.sentTo ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-300">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Sent
                        </span>
                      ) : (
                        <button type="button" onClick={() => openSend(shot.id)} className="hud-btn !px-2 !py-1 text-[11px]" aria-expanded={sending === shot.id}>
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                          Send
                        </button>
                      )}
                      <span className="flex gap-1">
                        <a href={shot.image} download={`argus-${activeCrewMember.callsign.toLowerCase()}-${shot.id}.jpg`} className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text" aria-label="Download photo">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => setShots((s) => s.filter((x) => x.id !== shot.id))}
                          className="hud-focus rounded p-1 text-hud-muted hover:text-red-300"
                          aria-label="Delete photo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                    {sending === shot.id && (
                      <div className="space-y-2 border-t border-hud-line p-2">
                        <p className="text-[11px] text-hud-muted">Send to</p>
                        {contacts.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {contacts.map((c) => (
                              <Chip
                                key={c.id}
                                active={sendTo.includes(c.name)}
                                onClick={() => setSendTo((s) => (s.includes(c.name) ? s.filter((n) => n !== c.name) : [...s, c.name]))}
                              >
                                {c.name}
                              </Chip>
                            ))}
                          </div>
                        )}
                        <AddContactForm compact onAdd={(n, r) => addContact(n, r, true)} />
                        <p className="text-[11px] text-hud-muted">
                          Arrives in <span className="font-mono text-amber-300">{lightTime}</span>
                        </p>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => send(shot)} disabled={!sendTo.length} className="hud-btn-primary flex-1 !py-1 text-xs">
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Send
                          </button>
                          <button type="button" onClick={() => setSending(null)} className="hud-btn !py-1 text-xs">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Overlays &amp; stickers</h3>
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
              <span className="mb-1 block text-xs text-hud-muted">Message on the photo and for the family</span>
              <input className="hud-input" value={message} maxLength={80} onChange={(e) => setMessage(e.target.value)} placeholder="Miss you! Look at this view" />
            </label>
          </section>
        </Card>
      </div>

      {viewing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setViewing(null)}>
          <img src={viewing} alt="Photo, larger" className="max-h-[85vh] max-w-full rounded-lg border border-hud-line object-contain" />
          <button type="button" onClick={() => setViewing(null)} className="hud-btn absolute right-4 top-4" aria-label="Close photo">
            <X className="h-4 w-4" />
          </button>
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
            <p className="text-sm text-hud-muted">No photos sent yet. Take one and press Send.</p>
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
          <div className="mt-2">
            <AddContactForm onAdd={(n, r) => addContact(n, r)} />
          </div>
          <p className="mt-2 text-[11px] text-hud-muted">Photos and family details stay on this device. Camera frames are never uploaded.</p>
        </Card>
      </div>
    </div>
  );
};
