/**
 * ARGUS console right rail (specs/02-ui-dashboard.md §2.4): what ARGUS sees, the emergency
 * protocol, steps to follow, things to try, how the crew member is doing, and the link to
 * the doctors on Earth.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Biohazard,
  Camera,
  CameraOff,
  CheckCircle2,
  Circle,
  ClipboardList,
  CloudFog,
  Earth,
  Eye,
  Flame,
  HeartHandshake,
  HeartPulse,
  Play,
  Send,
  ShieldCheck,
  Siren,
  Smile,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Wind,
  X,
} from 'lucide-react';
import { useAssistant } from '../../context/AssistantContext';
import { useMission } from '../../context/MissionContext';
import { EMERGENCY_DISCLAIMER, EMERGENCY_PROTOCOLS } from '../../data/emergencyProtocols';
import { CUE_IDS, CUE_LABELS } from '../../../shared/mentalState';
import { Card } from '../ui/Card';
import { InfoTip } from '../InfoTip';
import type { ConcernLevel, EarthReport, EmotionLabel } from '../../types/assistant';
import type { RedFlagProtocolId } from '../../../shared/redFlags';

const ICONS: Record<string, React.FC<{ className?: string }>> = { Flame, Wind, Biohazard, HeartPulse, Sun, CloudFog };
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const EMOTION_WORD: Record<EmotionLabel, string> = {
  neutral: 'Neutral',
  happy: 'Happy',
  sad: 'Sad',
  angry: 'Angry',
  fearful: 'Fearful',
  surprised: 'Surprised',
  disgusted: 'Disgusted',
};

// ── What ARGUS sees ──────────────────────────────────────────────────────────

export const SelfView: React.FC = () => {
  const { camera, attachVideo, enableCamera, disableCamera, grantCameraConsent, observation, closeUpRequest, sendCloseUp, dismissCloseUp, tier } = useAssistant();
  const o = observation;
  const emotion = o?.emotion && o.emotion.confidence >= 0.3 ? o.emotion : null;
  const showVideo = camera === 'on' || camera === 'starting';
  const sends = tier.effective === 'live' ? 'Live video goes to Earth AI.' : tier.effective === 'relay' ? 'A still goes with each message.' : 'Stays on the ship.';

  return (
    <Card
      title="What ARGUS sees"
      icon={<Eye className="h-4 w-4" />}
      bodyClassName="p-3 pt-0"
      actions={
        camera === 'on' ? (
          <button type="button" className="hud-btn px-2 py-1" onClick={disableCamera} aria-label="Turn camera off">
            <CameraOff className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : camera === 'off' || camera === 'blocked' ? (
          <button type="button" className="hud-btn px-2 py-1" onClick={() => void enableCamera()} aria-label="Turn camera on">
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null
      }
    >
      <div className="relative aspect-video overflow-hidden rounded-lg border border-hud-line bg-hud-bg">
        <video ref={attachVideo} muted playsInline className={`h-full w-full -scale-x-100 object-cover ${showVideo ? '' : 'hidden'}`} aria-label="Your camera" />
        {camera === 'needs_consent' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <ShieldCheck className="h-6 w-6 text-hud-accent" aria-hidden="true" />
            <p className="text-xs text-hud-muted">
              Let ARGUS see you so it can notice tiredness, stress and how you seem. Face analysis runs on this device. {sends}
            </p>
            <button type="button" className="hud-btn-primary py-1.5 text-xs" onClick={() => void grantCameraConsent()}>
              Turn on camera
            </button>
          </div>
        )}
        {(camera === 'off' || camera === 'blocked') && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-hud-muted">
            {camera === 'blocked' ? 'Camera blocked. Allow it in the browser.' : 'Camera off'}
          </div>
        )}
        {camera === 'on' && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-hud-text">
            <span className="h-1.5 w-1.5 rounded-full bg-status-red" aria-hidden="true" />
            Camera on
          </span>
        )}
        {camera === 'on' && o && (
          <div className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
            {!o.facePresent ? (
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-hud-muted">Not in frame</span>
            ) : (
              <>
                {emotion && (
                  <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-hud-text">
                    <Smile className="h-3 w-3" aria-hidden="true" />
                    {EMOTION_WORD[emotion.label]} {Math.round(emotion.confidence * 100)}%
                  </span>
                )}
                {o.fatigue && o.fatigue !== 'low' && (
                  <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-status-yellow">{o.fatigue === 'high' ? 'Very tired' : 'Tired'}</span>
                )}
                {o.posture === 'slumped' && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-hud-text">Slumped</span>}
                {o.restlessness === 'high' && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-hud-text">Restless</span>}
                {o.pulseBpmEstimate !== null && (o.pulseConfidence ?? 0) >= 0.5 && (
                  <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-hud-text">~{o.pulseBpmEstimate} bpm</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {camera === 'on' && o?.facePresent && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-hud-muted">
          {emotion && (
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-hud-line" aria-label="Facial expression mix over the last 30 seconds" role="img">
              {(Object.entries(emotion.scores) as Array<[EmotionLabel, number]>)
                .filter(([, v]) => v >= 0.04)
                .sort((a, b) => b[1] - a[1])
                .map(([label, v]) => (
                  <span
                    key={label}
                    title={`${EMOTION_WORD[label]} ${Math.round(v * 100)}%`}
                    style={{ width: `${v * 100}%` }}
                    className={
                      label === 'happy'
                        ? 'bg-status-green'
                        : label === 'sad'
                          ? 'bg-hud-drift'
                          : label === 'angry' || label === 'disgusted'
                            ? 'bg-status-red'
                            : label === 'fearful'
                              ? 'bg-status-yellow'
                              : 'bg-slate-500'
                    }
                  />
                ))}
            </div>
          )}
          <InfoTip label="About camera analysis" align="right">
            <span className="block">
              Expression, eye closure, yawns, posture and a camera pulse estimate, worked out on this device over the last 30 seconds. They are clues ARGUS uses to ask how you are, not a diagnosis. The pulse estimate is never logged as a vital.
            </span>
            <span className="mt-1 block">{sends}</span>
          </InfoTip>
        </div>
      )}

      {closeUpRequest && (
        <div className="mt-2 rounded-lg border border-hud-accent/50 bg-hud-accent/10 p-2.5" role="status">
          <p className="text-xs text-hud-text">
            ARGUS asked to see: <strong>{closeUpRequest}</strong>
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="hud-btn-primary py-1 text-xs" onClick={() => void sendCloseUp()} disabled={camera !== 'on'}>
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Send close-up
            </button>
            <button type="button" className="hud-btn" onClick={dismissCloseUp}>
              Not now
            </button>
          </div>
        </div>
      )}
    </Card>
  );
};

// ── Emergency ────────────────────────────────────────────────────────────────

export const EmergencyCard: React.FC = () => {
  const { emergency, startEmergency, toggleEmergencyStep, endEmergency, emergencyPickerOpen, setEmergencyPickerOpen, tier } = useAssistant();

  if (emergency) {
    const done = Object.keys(emergency.completed).length;
    const protocol = EMERGENCY_PROTOCOLS.find((p) => p.id === emergency.protocolId);
    const Icon = ICONS[protocol?.icon ?? ''] ?? Siren;
    return (
      <Card
        title={emergency.title}
        icon={<Icon className="h-4 w-4 text-red-300" />}
        className="border-status-red/60 bg-red-950/30"
        actions={
          <span className="font-mono text-[11px] text-hud-muted">
            {done}/{emergency.steps.length} · {clock(emergency.startedAtIso)}
          </span>
        }
      >
        <p className="mb-2 text-xs text-red-100">
          <strong>Act first.</strong> Say &ldquo;done&rdquo; after each step, or tick it. Earth is {tier.oneWaySec < 1 ? 'in real time' : `${Math.round(tier.oneWaySec)} s away`}.
        </p>
        <ol className="space-y-1">
          {emergency.steps.map((step, i) => {
            const n = i + 1;
            const at = emergency.completed[n];
            const next = !at && Object.keys(emergency.completed).length === i;
            return (
              <li key={n}>
                <button
                  type="button"
                  aria-pressed={Boolean(at)}
                  onClick={() => toggleEmergencyStep(n)}
                  className={`hud-focus flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hud-bg/60 ${next ? 'bg-status-red/10' : ''}`}
                >
                  {at ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-hud-muted" aria-hidden="true" />}
                  <span className={at ? 'text-hud-muted line-through' : 'text-hud-text'}>
                    <span className="mr-1 font-mono text-xs text-hud-muted">{n}.</span>
                    {step}
                  </span>
                  {at && <span className="ml-auto shrink-0 font-mono text-[11px] text-hud-muted">{clock(at)}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[10px] text-hud-muted">{EMERGENCY_DISCLAIMER}</p>
          <button type="button" className="hud-btn shrink-0" onClick={endEmergency}>
            Close &amp; report
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Emergency protocols"
      icon={<Siren className="h-4 w-4 text-red-300" />}
      bodyClassName={emergencyPickerOpen ? 'p-3 pt-0' : 'hidden'}
      actions={
        <button type="button" className="hud-btn px-2 py-1" aria-expanded={emergencyPickerOpen} onClick={() => setEmergencyPickerOpen(!emergencyPickerOpen)}>
          {emergencyPickerOpen ? 'Hide' : 'Show'}
        </button>
      }
    >
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {EMERGENCY_PROTOCOLS.map((p) => {
          const Icon = ICONS[p.icon] ?? Siren;
          return (
            <li key={p.id}>
              <button
                type="button"
                className="hud-focus flex w-full items-center gap-2 rounded-lg border border-status-red/40 bg-red-950/30 px-2.5 py-2 text-left text-xs text-red-100 hover:bg-red-900/40"
                onClick={() => startEmergency(p.id as RedFlagProtocolId)}
                title={p.trigger}
              >
                <Icon className="h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
                <span className="flex-1">{p.title}</span>
                <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

// ── Steps ARGUS laid out ─────────────────────────────────────────────────────

export const StepsCard: React.FC = () => {
  const { guidedSteps, toggleGuidedStep, clearGuidedSteps } = useAssistant();
  if (!guidedSteps) return null;
  return (
    <Card
      title={guidedSteps.title}
      icon={<ClipboardList className="h-4 w-4" />}
      actions={
        <button type="button" className="hud-btn px-2 py-1" onClick={clearGuidedSteps} aria-label="Close steps">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      }
    >
      <ol className="space-y-1">
        {guidedSteps.steps.map((s, i) => {
          const done = guidedSteps.completed.includes(i + 1);
          return (
            <li key={i}>
              <button type="button" aria-pressed={done} onClick={() => toggleGuidedStep(i + 1)} className="hud-focus flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hud-bg/60">
                {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden="true" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-hud-muted" aria-hidden="true" />}
                <span className={done ? 'text-hud-muted line-through' : 'text-hud-text'}>{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
};

// ── Things to try ────────────────────────────────────────────────────────────

export const CountermeasureCards: React.FC = () => {
  const { countermeasures, rateCountermeasure, dismissCountermeasure } = useAssistant();
  const open = countermeasures.filter((c) => c.helped === undefined).slice(-2);
  if (!open.length) return null;
  return (
    <Card title="Try this now" icon={<HeartHandshake className="h-4 w-4" />}>
      <ul className="space-y-3">
        {open.map(({ suggestion: s }) => (
          <li key={s.id} className="rounded-lg border border-hud-accent/30 bg-hud-accent/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-hud-text">{s.title}</p>
              <span className="shrink-0 font-mono text-[11px] text-hud-muted">{s.durationMinutes} min</span>
            </div>
            <p className="mt-1 text-sm text-hud-muted">{s.instruction}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-hud-muted">Did it help?</span>
              <button type="button" className="hud-btn px-2 py-1" onClick={() => rateCountermeasure(s.id, true)}>
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                Yes
              </button>
              <button type="button" className="hud-btn px-2 py-1" onClick={() => rateCountermeasure(s.id, false)}>
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                No
              </button>
              <button type="button" className="ml-auto text-[11px] text-hud-muted underline-offset-2 hover:underline" onClick={() => dismissCountermeasure(s.id)}>
                Skip
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

// ── How you're doing ─────────────────────────────────────────────────────────

const CONCERN: Record<ConcernLevel, { word: string; cls: string }> = {
  none: { word: 'Doing OK', cls: 'border-status-green/40 bg-status-green/10 text-status-green' },
  watch: { word: 'Keeping an eye on', cls: 'border-status-yellow/40 bg-status-yellow/10 text-status-yellow' },
  concern: { word: 'Some strain', cls: 'border-orange-400/40 bg-orange-400/10 text-orange-300' },
  urgent: { word: 'Needs a person now', cls: 'border-status-red/50 bg-status-red/15 text-red-200' },
};

const MOOD_WORD = { good: 'Good', ok: 'OK', low: 'Low', very_low: 'Very low' } as const;
const LEVEL_WORD = { low: 'Low', moderate: 'Moderate', high: 'High' } as const;

export const WellbeingCard: React.FC = () => {
  const { assessment, assessmentHistory } = useAssistant();
  const history = useMemo(() => assessmentHistory.slice(-20), [assessmentHistory]);
  if (!assessment) {
    return (
      <Card title="How you're doing" icon={<HeartPulse className="h-4 w-4" />}>
        <p className="text-sm text-hud-muted">ARGUS will get a sense of this as you talk.</p>
      </Card>
    );
  }
  const c = CONCERN[assessment.concernLevel];
  const topCues = CUE_IDS.filter((id) => assessment.cues[id] >= 2);
  const max = 100;
  return (
    <Card
      title="How you're doing"
      icon={<HeartPulse className="h-4 w-4" />}
      actions={<span className={`rounded-full border px-2 py-0.5 text-[11px] ${c.cls}`}>{c.word}</span>}
    >
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Mood', MOOD_WORD[assessment.mood]],
          ['Stress', LEVEL_WORD[assessment.stress]],
          ['Fatigue', LEVEL_WORD[assessment.fatigue]],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-hud-line bg-hud-bg/60 px-2 py-1.5">
            <dt className="text-[10px] uppercase tracking-wider text-hud-muted">{k}</dt>
            <dd className="text-sm font-semibold text-hud-text">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-hud-text">{assessment.summary}</p>
      {topCues.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {topCues.map((id) => (
            <li key={id} className="rounded-full border border-hud-line px-2 py-0.5 text-[11px] text-hud-muted">
              {CUE_LABELS[id]}
            </li>
          ))}
        </ul>
      )}
      {history.length > 1 && (
        <div className="mt-3">
          <svg viewBox={`0 0 ${(history.length - 1) * 10} 30`} className="h-8 w-full" preserveAspectRatio="none" role="img" aria-label={`Concern trend: ${assessment.trend}`}>
            <polyline
              fill="none"
              strokeWidth="1.5"
              className="stroke-hud-drift"
              vectorEffect="non-scaling-stroke"
              points={history.map((h, i) => `${i * 10},${30 - (h.score / max) * 28 - 1}`).join(' ')}
            />
          </svg>
          <p className="text-[11px] text-hud-muted">Trend: {assessment.trend}</p>
        </div>
      )}
      {assessment.evidence.length > 0 && (
        <details className="mt-2 text-xs text-hud-muted">
          <summary className="cursor-pointer hover:text-hud-text">What ARGUS noticed</summary>
          <ul className="mt-1 space-y-0.5">
            {assessment.evidence.map((e, i) => (
              <li key={i}>
                <span className="text-hud-text">{e.source === 'conversation' ? 'You said' : e.source === 'camera' ? 'Camera' : e.source === 'self_report' ? 'Check-in' : 'Body data'}:</span> {e.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[10px] text-hud-muted">Screening to help ARGUS support you, not a diagnosis. Concerns go to the doctors on Earth.</p>
    </Card>
  );
};

// ── Doctors on Earth ─────────────────────────────────────────────────────────

const URGENCY = {
  routine_downlink: { word: 'Routine', cls: 'text-hud-muted' },
  priority_packet: { word: 'Priority', cls: 'text-status-yellow' },
  immediate_emergency_packet: { word: 'Emergency', cls: 'text-red-300' },
} as const;

function reportState(r: EarthReport, now: number): string {
  if (r.reply?.arrived) return 'Replied';
  if (r.reply) return 'Reply on its way';
  if (Date.parse(r.deliverAtIso) > now) {
    const s = Math.ceil((Date.parse(r.deliverAtIso) - now) / 1000);
    return `In transit · ${s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`}`;
  }
  return r.readAtIso ? 'Read by Earth' : 'Delivered';
}

export const EarthLinkCard: React.FC = () => {
  const { reports, sendReport, lastReportNotice, tier } = useAssistant();
  const { serverBacked } = useMission();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    await sendReport({ urgency: 'priority_packet', kind: 'medical', note: note.trim() || 'Crew requested a check-in with the doctors on Earth.', crewNote: note.trim() || undefined });
    setNote('');
    setOpen(false);
  };

  return (
    <Card
      title="Doctors on Earth"
      icon={<Earth className="h-4 w-4" />}
      actions={
        <span className="font-mono text-[11px] text-hud-muted">
          {tier.roundTripSec < 1 ? 'real time' : `${tier.roundTripSec >= 90 ? `${Math.round(tier.roundTripSec / 60)} min` : `${Math.round(tier.roundTripSec)} s`} round trip`}
        </span>
      }
    >
      {lastReportNotice && (
        <p role="status" className="mb-2 rounded-lg border border-hud-accent/30 bg-hud-accent/10 px-2.5 py-1.5 text-xs text-hud-accent">
          {lastReportNotice}
        </p>
      )}
      {reports.length === 0 ? (
        <p className="text-sm text-hud-muted">No reports yet. ARGUS sends one when something needs a doctor&apos;s eyes, and you can send one any time.</p>
      ) : (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {reports.slice(0, 8).map((r) => (
            <li key={r.id} className="rounded-lg border border-hud-line bg-hud-bg/60 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className={URGENCY[r.urgency].cls}>
                  {URGENCY[r.urgency].word} · {r.kind}
                </span>
                <span className="text-hud-muted">{reportState(r, now)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-hud-text">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="mt-2 space-y-2">
          <label htmlFor="earth-note" className="text-xs text-hud-muted">
            What should the doctors know? ARGUS adds your readings and how you have been doing.
          </label>
          <textarea id="earth-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="hud-input resize-none font-sans" />
          <div className="flex gap-2">
            <button type="button" className="hud-btn-primary py-1.5 text-xs" onClick={() => void submit()}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Send report
            </button>
            <button type="button" className="hud-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="hud-btn mt-2 w-full" onClick={() => setOpen(true)}>
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Report to Earth
        </button>
      )}
      {!serverBacked && <p className="mt-2 text-[10px] text-hud-muted">Offline demo: reports are kept in this browser.</p>}
    </Card>
  );
};
