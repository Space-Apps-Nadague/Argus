/**
 * ARGUS — Photobooth tab (specs/02-ui-dashboard.md §2.7)
 * A camera booth for the crew: a mission-camera data stamp, zero-g stickers, colour filters,
 * postcard frames and a classic 4-photo strip. The real background stays (no fake scenery).
 * Show a peace sign (✌️) → 3-second timer → photo. Photos land
 * in a strip under the camera (the camera keeps running) and go home through the Earth downlink
 * queue, arriving after the live light time; with the ARGUS server they are also emailed to the
 * family at that moment. Camera frames are processed on this device only.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, Download, ExternalLink, Eye, Hand, Heart, Mail, MapPin, Send, Trash2, Upload, UserPlus, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { useAuth } from '../context/AuthContext';
import { familyApi } from '../services/dataApi';
import { commDelayAt, formatCommDelay, marsTime } from '../data/spaceLocations';
import { VISUAL_EXAM_SAMPLES } from '../data/telemetryScenarios';
import { Card } from './ui/Card';
import {
  BoothRenderer,
  composeStrip,
  FILTERS,
  FRAMES,
  capitalise,
  placeName,
  STAGE_H,
  STAGE_W,
  stampLines,
  STICKERS,
  type BoothInfo,
  type BoothOptions,
  type StickerId,
} from '../features/photobooth/effects';
import { detectPeaceSign, loadVision, type VisionModels } from '../features/photobooth/vision';
import { IDLE, startCountdown, stepShutter, type ShutterState } from '../features/photobooth/gesture';
import {
  deliveryStatus,
  formatCountdown,
  isEmail,
  loadContacts,
  loadPostcards,
  newPostcard,
  saveContacts,
  savePostcard,
  updatePostcard,
  type FamilyContact,
  type FamilyPostcard,
} from '../features/photobooth/familyMail';

type CameraState = 'starting' | 'ready' | 'error';

interface Shot {
  id: string;
  image: string;
  sentTo?: string[];
  /** Postcard created when this photo was sent. */
  cardId?: string;
}

/** Photos kept in the strip for this session. */
const MAX_SHOTS = 8;
/** Photos in a strip, and the countdown between them. */
const STRIP_COUNT = 4;
const STRIP_GAP_MS = 2000;
/** A peace sign missed for less than this still counts as held. */
const SIGN_HOLD_GAP_MS = 180;
/** Places for "Greetings from …" (the default follows the top-bar location). */
const PLACES = ['Earth', 'orbit', 'lunar orbit', 'the Moon', 'deep space', 'Mars'];

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
const AddContactForm: React.FC<{ onAdd: (name: string, relation: string, email: string) => void }> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [email, setEmail] = useState('');
  const emailOk = !email.trim() || isEmail(email);
  return (
    <form
      className="grid grid-cols-2 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !emailOk) return;
        onAdd(name.trim(), relation.trim(), email.trim());
        setName('');
        setRelation('');
        setEmail('');
      }}
    >
      <input className="hud-input text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Family member name" />
      <input className="hud-input text-xs" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="e.g. daughter" aria-label="Relation" />
      <input
        className={`hud-input col-span-2 text-xs ${emailOk ? '' : 'border-red-500'}`}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (photos are emailed here)"
        aria-label="Email address"
        aria-invalid={!emailOk}
      />
      <button type="submit" className="hud-btn col-span-2 text-xs" disabled={!name.trim() || !emailOk}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Add family member
      </button>
    </form>
  );
};

/** Email line under a sent postcard. */
const EmailState: React.FC<{ card: FamilyPostcard; delivered: boolean }> = ({ card, delivered }) => {
  const e = card.email;
  if (!e) return null;
  if (e.status === 'no_server') return <p className="text-[11px] text-hud-muted">Email needs the ARGUS server (offline demo).</p>;
  if (e.status === 'simulated')
    return <p className="text-[11px] text-hud-muted">Demo: delivery simulated (no mail server running)</p>;
  if (e.status === 'failed') return <p className="text-[11px] text-red-300">{e.error ?? 'Email failed.'}</p>;
  if (e.status === 'scheduled') return <p className="text-[11px] text-hud-muted">{delivered ? 'Emailing…' : `Email goes out on arrival to ${e.recipients.join(', ')}`}</p>;
  if (e.mode === 'test')
    return (
      <p className="text-[11px] text-hud-muted">
        Test email (no mail server set up){' '}
        {e.previewUrl && (
          <a href={e.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-hud-accent underline">
            view it <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </p>
    );
  return <p className="text-[11px] text-emerald-300">Emailed to {e.recipients.join(', ')}</p>;
};

/** Under a sent photo: live countdown until it reaches the family, then Delivered. */
const ShotDelivery: React.FC<{ card?: FamilyPostcard; now: Date }> = ({ card, now }) => {
  if (!card)
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-300">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Sent
      </span>
    );
  const st = deliveryStatus(card, now);
  return st.delivered ? (
    <span className="flex items-center gap-1 text-[11px] text-emerald-300">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Delivered
    </span>
  ) : (
    <span className="flex items-center gap-1 font-mono text-[11px] text-amber-300" title={`On its way to ${card.to.join(', ')}`}>
      <Send className="h-3.5 w-3.5" aria-hidden="true" />
      {formatCountdown(st.secondsLeft)}
    </span>
  );
};

export const PhotoboothTab: React.FC = () => {
  const {
    activeCrewMember,
    spaceLocation,
    latestDay,
    visualExamAnalysis,
    activePreviewImageUrl,
    isAnalyzingVisual,
    runSampleVisualExam,
    runUploadedVisualExam,
    clearVisualExam,
  } = useMission();
  const { mode } = useAuth();
  const crewId = activeCrewMember.id;
  const autoPlace = placeName(spaceLocation.id);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraError, setCameraError] = useState('');
  const [models, setModels] = useState<VisionModels | null>(null);
  const [modelsError, setModelsError] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [signSeen, setSignSeen] = useState(false);

  const [opts, setOpts] = useState<BoothOptions>({ filter: 'none', frame: 'none', stickers: ['stamp', 'patch'] });
  const [boothMode, setBoothMode] = useState<'single' | 'strip'>('single');
  // "Greetings from …" follows the top-bar location unless the crew picks another place.
  const [placeChoice, setPlaceChoice] = useState<string>('auto');
  const [stripProgress, setStripProgress] = useState<number | null>(null);
  const place = placeChoice === 'auto' ? autoPlace : placeChoice;
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

  // In strip mode the live view has no frame: the strip gets its own caption.
  const liveOpts: BoothOptions = boothMode === 'strip' ? { ...opts, frame: 'none' } : opts;
  // Latest values for the animation loop without restarting it.
  const live = useRef({ opts: liveOpts, info, mode: boothMode });
  live.current = { opts: liveOpts, info, mode: boothMode };
  const stripFrames = useRef<HTMLCanvasElement[]>([]);
  const shutter = useRef<ShutterState>(IDLE);

  const takePhoto = useRef<() => void>(() => undefined);
  takePhoto.current = () => {
    const c = canvasRef.current;
    if (!c) return;
    shutterSound();
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    if (live.current.mode === 'strip') {
      // Keep this frame; after the 4th, build the strip. In between, a 2-second countdown.
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d')!.drawImage(c, 0, 0);
      stripFrames.current.push(copy);
      if (stripFrames.current.length < STRIP_COUNT) {
        setStripProgress(stripFrames.current.length);
        shutter.current = startCountdown(performance.now(), STRIP_GAP_MS);
        return;
      }
      const strip = composeStrip(stripFrames.current, live.current.info);
      stripFrames.current = [];
      setStripProgress(null);
      const shot: Shot = { id: `strip-${Date.now()}`, image: snapshot(strip, strip.width) };
      setShots((s) => [shot, ...s].slice(0, MAX_SHOTS));
      return;
    }
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
    let sign = false;
    // Smooth over single frames the model misses, so holding the sign is steady.
    let lastSeen = -Infinity;
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
        if (frame % 2 === 0) {
          try {
            if (detectPeaceSign(models, v, ts)) lastSeen = t;
          } catch {
            /* skip this frame */
          }
        }
        sign = t - lastSeen < SIGN_HOLD_GAP_MS;
        setSignSeen((prev) => (prev === sign ? prev : sign));
      }
      renderer.render(c.getContext('2d')!, v, o, inf, t);
      const step = stepShutter(shutter.current, sign, t);
      shutter.current = step.state;
      setCountdown((prev) => (prev === step.secondsLeft ? prev : step.secondsLeft));
      if (step.capture) takePhoto.current();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera, models]);

  const switchMode = (m: 'single' | 'strip') => {
    stripFrames.current = [];
    setStripProgress(null);
    setBoothMode(m);
  };

  const startTimer = () => {
    stripFrames.current = [];
    setStripProgress(boothMode === 'strip' ? 0 : null);
    shutter.current = startCountdown(performance.now());
  };

  const toggleSticker = (id: StickerId) =>
    setOpts((o) => ({ ...o, stickers: o.stickers.includes(id) ? o.stickers.filter((s) => s !== id) : [...o.stickers, id] }));

  const addContact = (name: string, relation: string, email: string, selectForSending = false) => {
    const next = [...contacts, { id: `fc-${Date.now()}`, name: name.slice(0, 40), relation: relation.slice(0, 30), email: email.slice(0, 200) || undefined }];
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
    const recipients = contacts.filter((c) => sendTo.includes(c.name) && c.email && isEmail(c.email));
    const card = newPostcard({ crewId, to: sendTo, message, image: shot.image, delaySeconds: delay });
    if (recipients.length) {
      card.email = { status: mode === 'server' ? 'scheduled' : 'no_server', recipients: recipients.map((r) => r.email!) };
    }
    if (mode !== 'server') {
      // DEMO MODE — no ARGUS server, so no email is sent. The delivery (light-time countdown, then
      // "Delivered") is simulated on screen and labelled "Demo" in the UI. Real email:
      // server/family/mailer.ts, used when the server runs.
      card.email = { status: 'simulated', recipients: sendTo };
    }
    setPostcards(savePostcard(card));
    setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, sentTo: sendTo, cardId: card.id } : x)));
    setSending(null);
    if (recipients.length && mode === 'server') {
      familyApi
        .send({
          id: card.id,
          crewId,
          callsign: activeCrewMember.callsign,
          place: capitalise(place),
          to: recipients.map((r) => ({ name: r.name, email: r.email! })),
          message,
          image: shot.image,
          delaySeconds: delay,
        })
        .catch((err: unknown) =>
          setPostcards(
            updatePostcard(crewId, card.id, {
              email: { status: 'failed', recipients: card.email!.recipients, error: err instanceof Error ? err.message : 'Email could not be queued.' },
            })
          )
        );
    }
  };

  // After a postcard's light time has passed, ask the server whether its email went out.
  useEffect(() => {
    if (mode !== 'server') return;
    const due = postcards.filter((p) => p.email?.status === 'scheduled' && deliveryStatus(p, now).delivered);
    if (!due.length || now.getSeconds() % 5 !== 0) return;
    due.forEach((p) =>
      familyApi
        .status(p.id)
        .then((st) => {
          if (st.status === 'scheduled') return;
          setPostcards(updatePostcard(crewId, p.id, { email: { ...p.email!, status: st.status, mode: st.mode, previewUrl: st.previewUrl, error: st.error } }));
        })
        .catch(() => undefined)
    );
  }, [now, postcards, mode, crewId]);

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
                {boothMode === 'strip' && (
                  <span className="absolute bottom-4 rounded bg-black/60 px-3 py-1 font-mono text-sm text-white">
                    Photo {(stripProgress ?? stripFrames.current.length) + 1} of {STRIP_COUNT}
                  </span>
                )}
              </div>
            )}
            {signSeen && countdown === null && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-emerald-500/85 px-3 py-1 text-sm font-semibold text-white" aria-live="polite">
                ✌️ Peace sign seen
              </div>
            )}
            {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-hud-muted">
            <MapPin className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
            Location: <span className="text-hud-text">{spaceLocation.label}</span> · captions say "Greetings from {capitalise(place)}".
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={startTimer} disabled={camera !== 'ready'} className="hud-btn-primary">
              <Camera className="h-4 w-4" aria-hidden="true" />
              {boothMode === 'strip' ? 'Take 4-photo strip' : 'Take photo (3 s)'}
            </button>
            <p className="flex items-center gap-1.5 text-xs text-hud-muted">
              <Hand className="h-4 w-4 text-hud-accent" aria-hidden="true" />
              {models
                ? 'Or show a peace sign ✌️ to the camera: the 3-second timer starts by itself.'
                : modelsError
                  ? 'Effects could not load; the plain camera still works.'
                  : 'Loading hand-gesture detection…'}
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
                        <ShotDelivery card={postcards.find((p) => p.id === shot.cardId)} now={now} />
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
                                {!c.email && <span className="text-hud-muted"> (no email)</span>}
                              </Chip>
                            ))}
                          </div>
                        )}
                        <AddContactForm onAdd={(n, r, e) => addContact(n, r, e, true)} />
                        <p className="text-[11px] text-hud-muted">
                          {mode === 'server' ? (
                            <>
                              Arrives in <span className="font-mono text-amber-300">{lightTime}</span>
                            </>
                          ) : (
                            <>
                              Arrives in <span className="font-mono text-amber-300">{lightTime}</span> <span className="text-hud-muted">(demo: simulated)</span>
                            </>
                          )}
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
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-hud-muted">Mode</h3>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={boothMode === 'single'} onClick={() => switchMode('single')}>
                Single photo
              </Chip>
              <Chip active={boothMode === 'strip'} onClick={() => switchMode('strip')}>
                4-photo strip
              </Chip>
            </div>
            {boothMode === 'strip' && (
              <p className="mt-1.5 text-xs text-hud-muted">Four photos, 2 seconds apart, on one strip with the mission caption.</p>
            )}
          </section>
          <section>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-hud-muted">Greetings from</span>
              <select className="hud-input" value={placeChoice} onChange={(e) => setPlaceChoice(e.target.value)}>
                <option value="auto">{capitalise(autoPlace)} (current location)</option>
                {PLACES.filter((p) => p !== autoPlace).map((p) => (
                  <option key={p} value={p}>
                    {capitalise(p)}
                  </option>
                ))}
              </select>
            </label>
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
            {boothMode === 'strip' ? (
              <p className="text-xs text-hud-muted">The 4-photo strip has its own caption card.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {FRAMES.map((f) => (
                  <Chip key={f.id} active={opts.frame === f.id} onClick={() => setOpts((o) => ({ ...o, frame: f.id }))}>
                    {f.label}
                  </Chip>
                ))}
              </div>
            )}
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
                          : `On its way to Earth · arrives in ${formatCountdown(st.secondsLeft)}`}
                      </p>
                      <EmailState card={p} delivered={st.delivered} />
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
                <span className="min-w-0">
                  {c.name}
                  {c.relation && <span className="text-hud-muted"> · {c.relation}</span>}
                  <span className="block truncate text-[11px] text-hud-muted">{c.email ?? 'No email: photo stays in Family mail only'}</span>
                </span>
                <button type="button" onClick={() => removeContact(c.id)} className="hud-focus rounded p-1 text-hud-muted hover:text-red-300" aria-label={`Remove ${c.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <AddContactForm onAdd={(n, r, e) => addContact(n, r, e)} />
          </div>
          <p className="mt-2 text-[11px] text-hud-muted">
            Family details stay on this device. Photos are emailed through the ARGUS server only to the addresses you add; camera frames are never uploaded.
          </p>
        </Card>
      </div>

      <Card title="Optic Nerve &amp; Medical Visual Exam" icon={<Eye className="h-4 w-4" />}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-hud-muted">
              Select a sample scan (e.g., <strong className="text-hud-text">SANS Optic Nerve Ultrasound</strong>) or upload an eye/skin photo to run visual triage.
            </p>
            <label className="hud-btn cursor-pointer text-xs">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void runUploadedVisualExam(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            {VISUAL_EXAM_SAMPLES.map((sample) => {
              const selected = activePreviewImageUrl === sample.previewSvgDataUrl;
              const isOptic = sample.id === 'sans_ultrasound';
              return (
                <button
                  key={sample.id}
                  type="button"
                  disabled={isAnalyzingVisual}
                  onClick={() => void runSampleVisualExam(sample)}
                  className={`hud-focus flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                    selected
                      ? isOptic
                        ? 'border-amber-400/80 bg-amber-950/30'
                        : 'border-hud-accent bg-hud-accent/15'
                      : 'border-hud-line bg-hud-panel/60 hover:border-hud-accent/60'
                  }`}
                >
                  <img
                    src={sample.previewSvgDataUrl}
                    alt={sample.title}
                    className="h-14 w-16 shrink-0 rounded border border-hud-line object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-hud-text">{sample.title}</div>
                    <div className="line-clamp-2 text-[11px] text-hud-muted">{sample.modality}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {isAnalyzingVisual && <p className="text-xs text-hud-accent">Analyzing visual scan…</p>}

          {visualExamAnalysis && (
            <div
              role="alert"
              className={`rounded-lg border p-3 ${
                visualExamAnalysis.findingStatus === 'red'
                  ? 'border-red-500/70 bg-red-950/40 text-red-100'
                  : visualExamAnalysis.findingStatus === 'yellow'
                    ? 'border-amber-400/70 bg-amber-950/35 text-amber-100'
                    : 'border-emerald-500/60 bg-emerald-950/30 text-emerald-100'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {visualExamAnalysis.findingStatus === 'red'
                      ? 'Critical Optic Nerve Alert'
                      : visualExamAnalysis.findingStatus === 'yellow'
                        ? 'Optic Nerve / Visual Caution'
                        : 'Nominal Visual Exam'}
                  </span>
                  <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
                    {visualExamAnalysis.modality}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearVisualExam}
                  className="hud-focus rounded px-2 py-0.5 text-[11px] underline opacity-80 hover:opacity-100"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                {activePreviewImageUrl && (
                  <img
                    src={activePreviewImageUrl}
                    alt="Analyzed visual scan"
                    className="h-28 w-36 shrink-0 rounded border border-white/15 object-cover"
                  />
                )}
                <div className="space-y-1.5 text-xs">
                  <p className="font-medium">{visualExamAnalysis.plainCrewGuidance}</p>
                  <p className="opacity-90">{visualExamAnalysis.clinicalSummary}</p>
                  <p className="font-semibold">Action: {visualExamAnalysis.recommendedAction}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
