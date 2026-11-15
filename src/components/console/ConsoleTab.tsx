/**
 * ARGUS console (specs/02-ui-dashboard.md §2.4): the one place to talk to ARGUS.
 * Replaces the ARGUS AI tab (chat, flight surgeon), the Companion drawer and the
 * Emergency tab. Talk, type or show; ARGUS answers as doctor and therapist and acts
 * in the rail beside the conversation.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot, ClipboardList, Cloud, Cpu, HeartHandshake, Inbox, MessageSquare, Microscope, Radio, Settings2, Stethoscope, Wifi } from 'lucide-react';
import { useAssistant } from '../../context/AssistantContext';
import { useAuth } from '../../context/AuthContext';
import { useMission } from '../../context/MissionContext';
import { COMM_TIER_PROFILES, COMM_TIERS, type CommTier } from '../../../shared/commProfile';
import { Card } from '../ui/Card';
import { InfoTip } from '../InfoTip';
import { FlightSurgeonPanel } from '../FlightSurgeonPanel';
import { DiagnosticsPanel, PlanPanel } from '../ai/InsightPanels';
import { WellbeingPanel } from '../ai/WellbeingPanel';
import { ConversationThread, Composer } from './Conversation';
import { CountermeasureCards, EarthLinkCard, EmergencyCard, SelfView, StepsCard, WellbeingCard } from './RailCards';
import { EarthInbox } from './EarthInbox';
import type { VoiceEngineId } from '../../types/assistant';

type Section = 'talk' | 'surgeon' | 'diagnostics' | 'plan' | 'checkin' | 'inbox';

const TIER_ICON: Record<CommTier, React.FC<{ className?: string }>> = { live: Wifi, relay: Cloud, autonomous: Cpu };

function delayText(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)} ms`;
  if (sec < 90) return `${sec.toFixed(1)} s`;
  return `${Math.round(sec / 60)} min`;
}

const TierBadge: React.FC = () => {
  const { tier, setTierOverride, speechEngine, liveConnected } = useAssistant();
  const profile = COMM_TIER_PROFILES[tier.effective];
  const Icon = TIER_ICON[tier.effective];
  const tone =
    tier.effective === 'live'
      ? 'border-status-green/40 bg-status-green/10 text-status-green'
      : tier.effective === 'relay'
        ? 'border-hud-accent/40 bg-hud-accent/10 text-hud-accent'
        : 'border-hud-drift/40 bg-hud-drift/10 text-hud-drift';
  const engineWord = speechEngine === 'live' ? 'Earth live voice' : speechEngine === 'gemini' ? 'Earth voice' : speechEngine === 'local' ? 'On-ship voice' : speechEngine === 'browser' ? 'Browser voice' : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tone}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {profile.label}
        {liveConnected && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-green" aria-label="connected" />}
        <span className="text-hud-muted">· {delayText(tier.oneWaySec)} one-way</span>
      </span>
      <InfoTip label="How ARGUS runs at this distance">
        <span className="block font-semibold text-hud-text">{profile.label}</span>
        <span className="mt-1 block">{profile.summary}</span>
        <span className="mt-1 block">
          AI: {profile.llm === 'on-ship' ? 'on-ship model' : 'Earth cloud model'}. Voice: {engineWord ?? (tier.effective === 'autonomous' ? 'on-ship engine' : 'Earth voice')}. Earth doctors:{' '}
          {profile.earthLink === 'real-time' ? 'reachable now' : 'queued reports'}.
        </span>
        {tier.note && <span className="mt-1 block text-status-yellow">{tier.note}</span>}
      </InfoTip>
      <label className="sr-only" htmlFor="tier-override">
        Comm mode
      </label>
      <select
        id="tier-override"
        className="hud-input w-auto py-1 text-xs"
        value={tier.override ?? 'auto'}
        onChange={(e) => setTierOverride(e.target.value === 'auto' ? null : (e.target.value as CommTier))}
        title="Force ARGUS further from Earth (for example, a comm blackout)"
      >
        <option value="auto">Auto ({COMM_TIER_PROFILES[tier.physical].label})</option>
        {COMM_TIERS.filter((t) => COMM_TIERS.indexOf(t) > COMM_TIERS.indexOf(tier.physical)).map((t) => (
          <option key={t} value={t}>
            {t === 'autonomous' ? 'Blackout: on-ship only' : COMM_TIER_PROFILES[t].label}
          </option>
        ))}
      </select>
    </div>
  );
};

const VoiceSettings: React.FC = () => {
  const { prefs, updatePrefs, voices, previewVoice, tier } = useAssistant();
  const [open, setOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = () => setBrowserVoices((window.speechSynthesis?.getVoices() ?? []).filter((v) => /^en/i.test(v.lang)));
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const engineList = (engine: Exclude<VoiceEngineId, 'browser'>) => voices?.voices.filter((v) => v.engine === engine) ?? [];
  const row = (engine: VoiceEngineId, label: string, available: boolean, options: Array<{ id: string; label: string }>, fallback?: string) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={`voice-${engine}`} className="text-xs font-semibold text-hud-text">
          {label}
        </label>
        <span className={`text-[10px] ${available ? 'text-status-green' : 'text-hud-muted'}`}>{available ? 'available' : 'not available'}</span>
      </div>
      <div className="flex gap-1.5">
        <select
          id={`voice-${engine}`}
          className="hud-input py-1 text-xs"
          value={prefs.voices[engine] ?? fallback ?? ''}
          onChange={(e) => updatePrefs({ voices: { [engine]: e.target.value } })}
          disabled={!options.length}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="hud-btn px-2" disabled={!available} onClick={() => previewVoice(engine, prefs.voices[engine] ?? fallback ?? options[0]?.id ?? '')}>
          Play
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="hud-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        Voice
      </button>
      {open && (
        <div role="dialog" aria-label="Voice settings" className="hud-card absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3">
          <p className="text-[11px] text-hud-muted">
            ARGUS uses the {tier.effective === 'autonomous' ? 'on-ship' : 'Earth'} voice at this distance and falls back to the next one if it is unavailable.
          </p>
          {row(
            'gemini',
            'Earth voice',
            Boolean(voices?.engines.gemini.available),
            engineList('gemini').map((v) => ({ id: v.id, label: `${v.label} · ${v.style}` })),
            voices?.defaults.gemini
          )}
          {row(
            'local',
            'On-ship voice',
            Boolean(voices?.engines.local.available),
            engineList('local').map((v) => ({ id: v.id, label: `${v.label} · ${v.style} (${v.language})` })),
            voices?.defaults.local
          )}
          {row(
            'browser',
            'Browser voice (last resort)',
            browserVoices.length > 0,
            browserVoices.map((v) => ({ id: v.name, label: v.name })),
            undefined
          )}
          <div>
            <label htmlFor="voice-rate" className="flex justify-between text-xs text-hud-text">
              Speed <span className="font-mono text-hud-muted">{prefs.rate.toFixed(2)}×</span>
            </label>
            <input id="voice-rate" type="range" min={0.8} max={1.3} step={0.05} value={prefs.rate} onChange={(e) => updatePrefs({ rate: Number(e.target.value) })} className="w-full accent-cyan-400" />
          </div>
          <label className="flex items-center gap-2 text-xs text-hud-text">
            <input type="checkbox" checked={prefs.speak} onChange={(e) => updatePrefs({ speak: e.target.checked })} className="accent-cyan-400" />
            Speak replies aloud
          </label>
        </div>
      )}
    </div>
  );
};

export const ConsoleTab: React.FC = () => {
  const { activeCrewMember } = useMission();
  const { currentUser } = useAuth();
  const { emergency } = useAssistant();
  const isSurgeon = currentUser?.role === 'flight_surgeon';
  const [section, setSection] = useState<Section>('talk');

  const sections: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
    { id: 'talk', label: 'Talk', icon: <MessageSquare className="h-4 w-4" /> },
    { id: 'surgeon', label: 'Flight Surgeon', icon: <Stethoscope className="h-4 w-4" /> },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Microscope className="h-4 w-4" /> },
    { id: 'plan', label: 'Plan', icon: <ClipboardList className="h-4 w-4" /> },
    { id: 'checkin', label: 'Check-in', icon: <HeartHandshake className="h-4 w-4" /> },
    ...(isSurgeon ? [{ id: 'inbox' as Section, label: 'Earth inbox', icon: <Inbox className="h-4 w-4" /> }] : []),
  ];

  // An emergency always brings the conversation back to the front.
  useEffect(() => {
    if (emergency) setSection('talk');
  }, [emergency]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-wide text-hud-text">
          <Bot className="h-5 w-5 text-hud-accent" aria-hidden="true" />
          ARGUS · {activeCrewMember.callsign}
        </h2>
        <TierBadge />
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <VoiceSettings />
          <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-hud-line bg-hud-panel/60 p-1" role="group" aria-label="Console section">
            {sections.map((s) => (
              <button key={s.id} type="button" aria-pressed={section === s.id} onClick={() => setSection(s.id)} className="hud-seg flex shrink-0 items-center gap-1.5 px-3 py-1.5">
                <span aria-hidden="true">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {section === 'talk' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Card className="lg:col-span-7 2xl:col-span-8" bodyClassName="flex h-[min(72vh,820px)] min-h-[460px] flex-col p-3">
            <ConversationThread />
            <Composer />
          </Card>
          <div className="space-y-3 lg:col-span-5 2xl:col-span-4">
            <EmergencyCard />
            <SelfView />
            <StepsCard />
            <CountermeasureCards />
            <WellbeingCard />
            <EarthLinkCard />
          </div>
        </div>
      ) : section === 'surgeon' ? (
        <FlightSurgeonPanel />
      ) : section === 'inbox' ? (
        <EarthInbox />
      ) : (
        <Card>
          {section === 'diagnostics' && <DiagnosticsPanel />}
          {section === 'plan' && <PlanPanel />}
          {section === 'checkin' && <WellbeingPanel />}
        </Card>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-hud-muted">
        <Radio className="h-3 w-3" aria-hidden="true" />
        ARGUS is decision support and someone to talk to. Serious concerns are confirmed by the doctors on Earth.
      </p>
    </div>
  );
};
