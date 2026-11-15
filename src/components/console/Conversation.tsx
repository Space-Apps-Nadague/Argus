/**
 * ARGUS console: the conversation thread and the composer (specs/02-ui-dashboard.md §2.4).
 * One thread for typing, talking, Earth replies and the actions ARGUS takes.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Earth,
  Eye,
  HeartHandshake,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Siren,
  Square,
  Stethoscope,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAssistant } from '../../context/AssistantContext';
import { useMission } from '../../context/MissionContext';
import { COMM_TIER_PROFILES } from '../../../shared/commProfile';
import { EMERGENCY_PROTOCOLS } from '../../data/emergencyProtocols';
import type { AssistantAction, AssistantMessage } from '../../types/assistant';
import type { RagDocKind, RagHit } from '../../types/aiApi';

const URGENCY_WORD = { routine_downlink: 'routine', priority_packet: 'priority', immediate_emergency_packet: 'emergency' } as const;

export function actionLabel(a: AssistantAction): { icon: React.ReactNode; text: string; tone: 'red' | 'accent' | 'green' | 'muted' } {
  switch (a.type) {
    case 'start_emergency_protocol':
      return { icon: <Siren className="h-3.5 w-3.5" />, text: `Started: ${EMERGENCY_PROTOCOLS.find((p) => p.id === a.protocolId)?.title ?? a.protocolId}`, tone: 'red' };
    case 'mark_step_done':
      return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: `Step ${a.stepNumber} done`, tone: 'green' };
    case 'log_checkin_reading':
      return {
        icon: <Stethoscope className="h-3.5 w-3.5" />,
        text: a.ok ? `Logged ${a.metricId.replace(/_/g, ' ')} ${a.value}${a.status ? ` · ${a.status.toUpperCase()}` : ''}` : `Not logged: ${a.message ?? 'invalid value'}`,
        tone: a.ok ? (a.status === 'red' ? 'red' : 'green') : 'muted',
      };
    case 'set_guided_steps':
      return { icon: <ClipboardList className="h-3.5 w-3.5" />, text: `Steps: ${a.title}`, tone: 'accent' };
    case 'queue_earth_packet':
      return { icon: <Earth className="h-3.5 w-3.5" />, text: `Report to Earth (${URGENCY_WORD[a.urgency]})`, tone: a.urgency === 'immediate_emergency_packet' ? 'red' : 'accent' };
    case 'request_visual_check':
      return { icon: <Eye className="h-3.5 w-3.5" />, text: `Show: ${a.target}`, tone: 'accent' };
    case 'suggest_countermeasure':
      return { icon: <HeartHandshake className="h-3.5 w-3.5" />, text: `Try: ${a.suggestion.title}`, tone: 'accent' };
  }
}

const TONE: Record<'red' | 'accent' | 'green' | 'muted', string> = {
  red: 'border-status-red/50 bg-status-red/10 text-red-200',
  accent: 'border-hud-accent/40 bg-hud-accent/10 text-hud-accent',
  green: 'border-status-green/40 bg-status-green/10 text-status-green',
  muted: 'border-hud-line text-hud-muted',
};

/** Plain text with **bold** only: models sometimes add emphasis even when asked not to. */
export function renderLightMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part.replace(/^#{1,4}\s+/gm, '')
  );
}

const RAG_KIND: Record<RagDocKind, string> = {
  emergency_checklist: 'Checklist',
  countermeasure: 'Countermeasure',
  clinical_reference: 'Clinical reference',
  medication: 'Medication',
};

/** Verified protocol chunks behind a reply: the full text is always one tap away. */
const Sources: React.FC<{ sources: RagHit[] }> = ({ sources }) => {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-1.5 max-w-[88%]">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Verified sources">
        <span className="flex items-center gap-1 text-[11px] text-hud-muted">
          <BookOpen className="h-3 w-3" aria-hidden="true" />
          Sources
        </span>
        {sources.map((s, i) => (
          <button
            key={`${s.documentId}-${i}`}
            type="button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            className={`hud-focus rounded-full border px-2 py-0.5 text-[11px] ${open === i ? 'border-hud-accent text-hud-accent' : 'border-hud-line text-hud-text hover:border-hud-accent/50'}`}
          >
            {s.title}
            {s.sourceId && <span className="ml-1 font-mono text-hud-muted">{s.sourceId}</span>}
          </button>
        ))}
      </div>
      {open !== null && sources[open] && (
        <div className="mt-1.5 rounded-lg border border-hud-line bg-hud-bg/70 p-2.5 text-xs">
          <p className="font-semibold text-hud-text">
            {sources[open].heading} <span className="font-normal text-hud-muted">· {RAG_KIND[sources[open].kind]} · {sources[open].origin}</span>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-hud-muted">{sources[open].content}</p>
        </div>
      )}
    </div>
  );
};

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const Bubble: React.FC<{ m: AssistantMessage }> = ({ m }) => {
  const mine = m.role === 'user';
  const earth = m.role === 'earth';
  const source =
    m.role === 'assistant' && m.meta
      ? m.meta.source === 'live_ai'
        ? `${m.meta.provider === 'local' ? 'On-ship' : 'Earth'} AI${m.meta.model ? ` · ${m.meta.model}` : ''}`
        : 'Onboard protocols'
      : null;
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          mine
            ? 'rounded-br-md bg-hud-accent/15 text-hud-text'
            : earth
              ? 'rounded-bl-md border border-hud-drift/50 bg-hud-drift/10 text-hud-text'
              : m.crisis
                ? 'rounded-bl-md border border-status-red/50 bg-status-red/10 text-hud-text'
                : 'rounded-bl-md border border-hud-line bg-hud-bg/70 text-hud-text'
        }`}
      >
        {earth && (
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-hud-drift">
            <Earth className="h-3.5 w-3.5" aria-hidden="true" />
            {m.author ?? 'Flight Surgeon'} · from Earth
          </p>
        )}
        <p className="whitespace-pre-wrap">
          {renderLightMarkdown(m.content)}
          {m.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-hud-accent align-middle" aria-hidden="true" />}
          {m.streaming && !m.content && <span className="text-hud-muted">ARGUS is thinking…</span>}
        </p>
      </div>
      {m.actions?.length ? (
        <ul className="mt-1.5 flex max-w-[88%] flex-wrap gap-1.5" aria-label="Actions ARGUS took">
          {m.actions.map((a, i) => {
            const l = actionLabel(a);
            return (
              <li key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE[l.tone]}`}>
                <span aria-hidden="true">{l.icon}</span>
                {l.text}
              </li>
            );
          })}
        </ul>
      ) : null}
      {m.sources?.length ? <Sources sources={m.sources} /> : null}
      <span className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-hud-muted">
        {m.modality === 'voice' && <AudioLines className="h-3 w-3" aria-label="Spoken" />}
        {time(m.timestampIso)}
        {source && <span>· {source}</span>}
      </span>
    </li>
  );
};

const STARTERS = [
  "I haven't been sleeping well",
  'How am I doing today?',
  'I feel a bit off and I do not know why',
  'Walk me through an eye check',
];

export const ConversationThread: React.FC = () => {
  const { messages, send, status, interim, voiceMode } = useAssistant();
  const { activeCrewMember } = useMission();
  const endRef = useRef<HTMLDivElement | null>(null);
  const last = messages[messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, last?.content.length, interim]);

  return (
    <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-1 py-2" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-10 text-center">
            <HeartHandshake className="h-8 w-8 text-hud-accent" aria-hidden="true" />
            <div>
              <p className="font-display text-sm tracking-wide text-hud-text">Hi {activeCrewMember.callsign}. I&apos;m here.</p>
              <p className="mt-1 max-w-md text-sm text-hud-muted">
                Talk to me about how you feel, a symptom, a reading, or anything on your mind. I&apos;m your doctor and someone to talk to.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="hud-btn" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </ol>
        )}
        {(status === 'listening' || status === 'transcribing') && (
          <p className="mt-3 text-right text-sm italic text-hud-muted" aria-live="polite">
            {interim || (status === 'transcribing' ? 'Transcribing…' : voiceMode === 'conversation' ? 'Listening…' : 'Listening… press the mic again to send')}
          </p>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
};

const STATUS_TEXT = { idle: 'Ready', listening: 'Listening', transcribing: 'Transcribing', thinking: 'Thinking', speaking: 'Speaking' } as const;

export const Composer: React.FC = () => {
  const {
    send,
    stop,
    status,
    voiceMode,
    startConversation,
    stopConversation,
    togglePushToTalk,
    micLevel,
    prefs,
    updatePrefs,
    latency,
    error,
    tier,
    liveConnected,
    speaking,
    interrupt,
    clearThread,
    messages,
    deviceSpeechStatus: device,
  } = useAssistant();
  const [text, setText] = useState('');
  const busy = status === 'thinking' || status === 'speaking' || status === 'transcribing';
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void send(t);
  };

  return (
    <div className="border-t border-hud-line pt-3">
      {error && (
        <p role="alert" className="mb-2 rounded-lg border border-status-red/40 bg-status-red/10 px-3 py-1.5 text-xs text-red-200">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="argus-composer" className="sr-only">
          Message ARGUS
        </label>
        <textarea
          id="argus-composer"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={voiceMode === 'conversation' ? 'Talk, or type here…' : 'Tell ARGUS how you are doing…'}
          className="hud-input min-h-[44px] flex-1 resize-none font-sans"
        />
        {busy ? (
          <button type="button" className="hud-btn h-11 w-11 shrink-0 p-0" onClick={stop} aria-label="Stop ARGUS">
            <Square className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="hud-btn-primary h-11 w-11 shrink-0 p-0" onClick={submit} disabled={!text.trim()} aria-label="Send message">
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {voiceMode === 'conversation' ? (
          <button type="button" className="hud-btn border-status-red/50 text-red-200" onClick={stopConversation}>
            <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
            End conversation
          </button>
        ) : (
          <button type="button" className="hud-btn border-hud-accent/50 text-hud-accent" onClick={() => void startConversation()} disabled={voiceMode === 'push'}>
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            Talk to ARGUS
          </button>
        )}
        <button
          type="button"
          className={`hud-btn ${voiceMode === 'push' ? 'border-hud-accent text-hud-accent' : ''}`}
          onClick={() => void togglePushToTalk()}
          disabled={voiceMode === 'conversation'}
          aria-pressed={voiceMode === 'push'}
          aria-label={voiceMode === 'push' ? 'Stop and send voice message' : 'Record a voice message'}
        >
          {voiceMode === 'push' ? <MicOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Mic className="h-3.5 w-3.5" aria-hidden="true" />}
          {voiceMode === 'push' ? 'Send voice' : 'Voice message'}
        </button>
        <button
          type="button"
          className="hud-btn"
          aria-pressed={prefs.speak}
          onClick={() => {
            if (prefs.speak) interrupt();
            updatePrefs({ speak: !prefs.speak });
          }}
          aria-label={prefs.speak ? 'Mute ARGUS voice' : 'Let ARGUS speak'}
        >
          {prefs.speak ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        {speaking && (
          <button type="button" className="hud-btn" onClick={interrupt}>
            Stop talking
          </button>
        )}

        {(voiceMode !== 'off' || status !== 'idle') && (
          <span className="flex items-center gap-2 text-xs text-hud-muted" role="status">
            {voiceMode !== 'off' && (
              <span className="flex h-3 items-end gap-0.5" aria-hidden="true">
                {[0.4, 0.7, 1, 0.7, 0.4].map((k, i) => (
                  <span key={i} className="w-1 rounded-sm bg-hud-accent transition-all" style={{ height: `${Math.max(15, Math.min(100, micLevel * 100 * k * 1.6))}%` }} />
                ))}
              </span>
            )}
            {STATUS_TEXT[status]}
            {liveConnected && <span className="text-status-green">· live</span>}
          </span>
        )}

        {(device.tts === 'loading' || device.stt === 'loading') && (
          <span className="text-[11px] text-hud-accent" role="status">
            Loading on-device {device.stt === 'loading' ? 'transcription' : 'voice'}
            {device.progress !== null ? ` ${device.progress}%` : '…'} (first time only)
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-hud-muted">
          {latency.firstTokenMs !== null && (
            <span title="Time to first word, and to first audio">
              {(latency.firstTokenMs / 1000).toFixed(1)} s{latency.firstAudioMs !== null ? ` · voice ${(latency.firstAudioMs / 1000).toFixed(1)} s` : ''}
            </span>
          )}
          <span className="hidden sm:inline">{COMM_TIER_PROFILES[tier.effective].label}</span>
          {messages.length > 0 && (
            <button type="button" className="hud-focus rounded p-1 hover:text-hud-text" onClick={() => void clearThread()} aria-label="Start a new conversation">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
};
