/**
 * ARGUS — Companion Chat Drawer (specs/02-ui-dashboard.md §5, specs/01-data-schema.md §7)
 * Single Source of Truth: specs/01-data-schema.md & specs/02-ui-dashboard.md
 *
 * Full-featured conversational companion:
 * - Slide-over drawer on the right side of the screen, available on every tab
 * - Deterministic offline brain first with 100% autonomous operation
 * - Live Clinical AI streaming second via backend (/api/ai/chat) with seamless fallback
 * - Optional Web Speech API voice synthesis (British voice heuristic) and dictation input
 * - Per-crew member local storage history
 * - Immediate safety guardrail: red flags / crisis immediately dispatch emergency protocol
 *   and never lower urgency or mutate triage status.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Mic,
  MicOff,
  Radio,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import {
  BodyZoneId,
  CompanionIntent,
  CompanionMessage,
  TriageStatus,
} from '../types/argus';
import { AiResultMeta, ChatRequest } from '../types/aiApi';
import { ENVIRONMENT_META, STATUS_LABELS } from '../utils/triageEngine';
import {
  CompanionBrainContext,
  determineCompanionIntent,
  generateOfflineCompanionReply,
} from '../utils/companionBrain';
import { streamCrewChat } from '../services/argusApi';
import { hasConfiguredAiKey } from '../services/flightSurgeonAi';

const QUICK_PROMPTS = [
  'How am I doing?',
  'Why is my HRV low?',
  'Radiation dose status',
  'Forecast next 72 hours',
  'Check my ONSD and eye pressure',
  'I have a headache',
];

const INTENT_BADGE_LABELS: Record<CompanionIntent, { label: string; color: string }> = {
  red_flag: { label: 'CRITICAL ALERT', color: 'bg-red-500/20 text-red-300 border-red-500/50' },
  status: { label: 'Readiness & Triage', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  metric: { label: 'Vital Biomarker', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  symptom: { label: 'Symptom Triage', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  forecast: { label: '72h Projection', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  why: { label: 'NASA HRP Link', color: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  radiation: { label: 'Radiation & SPE', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  help: { label: 'Mission Guide', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  fallback: { label: 'Companion Stance', color: 'bg-slate-700/20 text-slate-300 border-slate-600/40' },
};

function formatMessageTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const CompanionDrawer: React.FC = () => {
  const {
    isCompanionOpen,
    setCompanionOpen,
    activeCrewMember,
    environment,
    scenarioId,
    readinessScore,
    zoneStatuses,
    zones,
    activeCheckIns,
    spaceLocationId,
    checkInStreakDays,
    metricLinks,
    guidance,
    runtimeApiKey,
  } = useMission();

  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('argus_companion_voice') === 'true';
    } catch {
      return false;
    }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const envMeta = ENVIRONMENT_META[environment];
  const storageKey = `argus_companion_chat_${activeCrewMember.id}`;

  const speechRecognitionSupported = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const brainContext = useMemo<CompanionBrainContext>(
    () => ({
      crewMember: activeCrewMember,
      environment,
      scenarioId,
      readinessScore,
      zoneStatuses,
      zones,
      checkIns: activeCheckIns,
      streakDays: checkInStreakDays,
      metricLinks,
      guidance,
    }),
    [
      activeCrewMember,
      environment,
      scenarioId,
      readinessScore,
      zoneStatuses,
      zones,
      activeCheckIns,
      checkInStreakDays,
      metricLinks,
      guidance,
    ]
  );

  // Load per-crew conversation history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch {
      // ignore storage parsing error
    }

    // Default initial greeting if no messages on record
    const initialGreeting: CompanionMessage = {
      id: `initial-${activeCrewMember.id}`,
      crewId: activeCrewMember.id,
      role: 'argus',
      text: `Good sol, ${activeCrewMember.callsign}. ARGUS Companion is online with 100% autonomous capability in ${envMeta.label} (${envMeta.commDelay.replace(' ONE-WAY', '')} to Earth). I am reading your 5-zone biological telemetry against your pre-flight baselines. How are you feeling today?`,
      timestampIso: new Date().toISOString(),
      intent: 'status',
      source: 'offline_brain',
    };
    setMessages([initialGreeting]);
  }, [storageKey, activeCrewMember.id, activeCrewMember.callsign, envMeta.label, envMeta.commDelay]);

  // Persist conversation history
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(messages.slice(-50)));
      } catch {
        // ignore storage write failure
      }
    }
  }, [messages, storageKey]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isCompanionOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, isCompanionOpen]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isCompanionOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
    }
  }, [isCompanionOpen]);

  // Keyboard shortcut: Esc closes drawer
  useEffect(() => {
    if (!isCompanionOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCompanionOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompanionOpen, setCompanionOpen]);

  // Voice output playback (Web Speech API)
  const speakText = useCallback(
    (text: string) => {
      if (!voiceOutputEnabled || !speechSynthesisSupported) return;
      try {
        window.speechSynthesis.cancel();
        // Strip markdown characters and redundant whitespace for natural vocal delivery
        const clean = text
          .replace(/[*#_`•]/g, ' ')
          .replace(/\n+/g, ' ')
          .trim();
        if (!clean) return;

        const utterance = new SpeechSynthesisUtterance(clean);
        const voices = window.speechSynthesis.getVoices();
        // British voice heuristic matching ARGOS prototype
        const voice =
          voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|oliver|arthur|george/i.test(v.name)) ||
          voices.find((v) => /en-GB/i.test(v.lang)) ||
          voices.find((v) => /^en/i.test(v.lang));
        if (voice) utterance.voice = voice;
        utterance.rate = 0.95;
        utterance.pitch = 0.9;
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn('[ARGUS Speech] Speech synthesis failed:', e);
      }
    },
    [voiceOutputEnabled, speechSynthesisSupported]
  );

  const toggleVoiceOutput = () => {
    const next = !voiceOutputEnabled;
    setVoiceOutputEnabled(next);
    try {
      localStorage.setItem('argus_companion_voice', String(next));
    } catch {
      // ignore
    }
    if (!next && speechSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
  };

  // Voice dictation input (Web Speech API)
  const toggleSpeechRecognition = () => {
    if (!speechRecognitionSupported) return;

    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      return;
    }

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputValue((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn('[ARGUS Mic] Speech recognition error:', err);
      setIsListening(false);
    }
  };

  // Submit message handler
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputValue).trim();
    if (!text || isStreaming) return;

    setInputValue('');
    if (speechSynthesisSupported) {
      window.speechSynthesis.cancel();
    }

    const userMsg: CompanionMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      crewId: activeCrewMember.id,
      role: 'crew',
      text,
      timestampIso: new Date().toISOString(),
      source: 'offline_brain',
    };

    setMessages((prev) => [...prev, userMsg]);

    const intent = determineCompanionIntent(text);

    // Red flag / crisis check — safety guardrail: emergency protocol answers instantly offline
    if (intent === 'red_flag') {
      const reply = generateOfflineCompanionReply(text, brainContext);
      const argusMsg: CompanionMessage = {
        id: `msg-${Date.now() + 1}`,
        crewId: activeCrewMember.id,
        role: 'argus',
        text: reply.text,
        timestampIso: new Date().toISOString(),
        intent: 'red_flag',
        source: 'offline_brain',
      };
      setMessages((prev) => [...prev, argusMsg]);
      speakText(reply.text);
      return;
    }

    // Try Live Clinical AI if connected, with seamless deterministic fallback
    const canUseLiveAi = hasConfiguredAiKey(runtimeApiKey);
    if (canUseLiveAi) {
      setIsStreaming(true);
      setStreamingText('');
      let fullAccumulator = '';
      let responseSource: 'live_ai' | 'offline_brain' = 'offline_brain';

      try {
        const req: ChatRequest = {
          scenarioId,
          environment,
          locationId: spaceLocationId,
          crewMember: activeCrewMember,
          telemetryCheckIns: activeCheckIns,
          messages: [
            ...messages.slice(-8).map((m) => ({
              role: m.role === 'crew' ? ('user' as const) : ('assistant' as const),
              content: m.text,
              timestampIso: m.timestampIso,
            })),
            { role: 'user', content: text, timestampIso: new Date().toISOString() },
          ],
        };

        await streamCrewChat(
          req,
          (event) => {
            if (event.type === 'delta') {
              fullAccumulator += event.text;
              setStreamingText(fullAccumulator);
            } else if (event.type === 'meta') {
              if (event.meta?.source === 'live_ai') {
                responseSource = 'live_ai';
              }
            }
          },
          { runtimeApiKey }
        );

        if (fullAccumulator.trim()) {
          const argusMsg: CompanionMessage = {
            id: `msg-${Date.now() + 1}`,
            crewId: activeCrewMember.id,
            role: 'argus',
            text: fullAccumulator,
            timestampIso: new Date().toISOString(),
            intent,
            source: responseSource,
          };
          setMessages((prev) => [...prev, argusMsg]);
          speakText(fullAccumulator);
        } else {
          throw new Error('Empty AI response');
        }
      } catch (err) {
        console.warn('[ARGUS Companion] Backend unavailable or stream error, using offline brain:', err);
        const fallback = generateOfflineCompanionReply(text, brainContext);
        const argusMsg: CompanionMessage = {
          id: `msg-${Date.now() + 1}`,
          crewId: activeCrewMember.id,
          role: 'argus',
          text: fallback.text,
          timestampIso: new Date().toISOString(),
          intent: fallback.intent,
          source: 'offline_brain',
        };
        setMessages((prev) => [...prev, argusMsg]);
        speakText(fallback.text);
      } finally {
        setIsStreaming(false);
        setStreamingText('');
      }
    } else {
      // Pure deterministic offline brain response
      const reply = generateOfflineCompanionReply(text, brainContext);
      const argusMsg: CompanionMessage = {
        id: `msg-${Date.now() + 1}`,
        crewId: activeCrewMember.id,
        role: 'argus',
        text: reply.text,
        timestampIso: new Date().toISOString(),
        intent: reply.intent,
        source: 'offline_brain',
      };
      setMessages((prev) => [...prev, argusMsg]);
      speakText(reply.text);
    }
  };

  const handleClearHistory = () => {
    const initialGreeting: CompanionMessage = {
      id: `initial-${activeCrewMember.id}-${Date.now()}`,
      crewId: activeCrewMember.id,
      role: 'argus',
      text: `Good sol, ${activeCrewMember.callsign}. ARGUS Companion is online with 100% autonomous onboard capability in ${envMeta.label}. Ready to assist.`,
      timestampIso: new Date().toISOString(),
      intent: 'status',
      source: 'offline_brain',
    };
    setMessages([initialGreeting]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  };

  if (!isCompanionOpen) return null;

  return (
    <>
      {/* Backdrop overlay on mobile / narrow viewports */}
      <div
        className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm transition-opacity"
        onClick={() => setCompanionOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-over Drawer */}
      <aside
        role="dialog"
        aria-label="ARGUS Companion Chat Drawer"
        className="fixed inset-y-0 right-0 z-50 flex w-full sm:w-[480px] md:w-[520px] max-w-full flex-col border-l border-hud-line bg-slate-950/95 shadow-2xl backdrop-blur-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hud-line px-4 py-3 bg-hud-panel/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-hud-accent/40 bg-hud-accent/15 text-hud-accent">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-sm font-bold tracking-wider text-hud-text">
                  ARGUS Companion
                </h2>
                <span className="rounded-full border border-status-green/40 bg-status-green/10 px-2 py-0.5 text-[10px] font-mono text-status-green font-medium">
                  Autonomous AI
                </span>
              </div>
              <p className="text-[11px] text-hud-muted truncate">
                Clinical decision support · {activeCrewMember.callsign} ({readinessScore}%)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {speechSynthesisSupported && (
              <button
                type="button"
                onClick={toggleVoiceOutput}
                aria-label={voiceOutputEnabled ? 'Mute voice replies' : 'Enable voice replies'}
                title={voiceOutputEnabled ? 'Voice output enabled' : 'Voice output muted'}
                className={`hud-focus rounded-lg border p-1.5 transition-colors ${
                  voiceOutputEnabled
                    ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300'
                    : 'border-hud-line bg-hud-panel text-hud-muted hover:text-hud-text'
                }`}
              >
                {voiceOutputEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={handleClearHistory}
              aria-label="Clear chat history"
              title="Clear conversation history"
              className="hud-focus rounded-lg border border-hud-line bg-hud-panel p-1.5 text-hud-muted hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setCompanionOpen(false)}
              aria-label="Close ARGUS Companion"
              className="hud-focus rounded-lg border border-hud-line bg-hud-panel p-1.5 text-hud-muted hover:text-hud-text transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status & Comm Delay Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line/70 bg-hud-bg/70 px-4 py-1.5 text-[11px] text-hud-muted">
          <div className="flex items-center gap-2 font-mono">
            <Radio className="h-3 w-3 text-amber-400" aria-hidden="true" />
            <span>Comm Delay:</span>
            <span className="text-amber-300">{envMeta.commDelay.replace(' ONE-WAY', '')} to Earth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse" aria-hidden="true" />
            <span className="font-mono text-[10px] text-hud-text/90">
              {hasConfiguredAiKey(runtimeApiKey) ? 'Live AI + Offline Brain' : 'Deterministic Offline Brain'}
            </span>
          </div>
        </div>

        {/* Quick Prompts Tray */}
        <div className="border-b border-hud-line/50 bg-hud-panel/30 px-3 py-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-hud-muted shrink-0 flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-cyan-400" /> Prompts:
            </span>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleSendMessage(prompt)}
                disabled={isStreaming}
                className="hud-focus shrink-0 rounded-full border border-hud-line bg-hud-bg/80 px-2.5 py-1 text-[11px] text-hud-muted hover:border-cyan-400/50 hover:text-cyan-200 transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 no-scrollbar">
          {messages.map((msg) => {
            const isCrew = msg.role === 'crew';
            const isRedFlag = msg.intent === 'red_flag';
            const intentBadge = msg.intent ? INTENT_BADGE_LABELS[msg.intent] : null;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isCrew ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-hud-muted font-mono">
                  <span>{isCrew ? activeCrewMember.callsign : 'ARGUS Autonomous'}</span>
                  <span>·</span>
                  <span>{formatMessageTime(msg.timestampIso)}</span>
                  {!isCrew && msg.source && (
                    <>
                      <span>·</span>
                      <span className={msg.source === 'live_ai' ? 'text-status-green font-semibold' : 'text-cyan-400'}>
                        {msg.source === 'live_ai' ? 'Clinical AI' : 'Offline Brain'}
                      </span>
                    </>
                  )}
                  {!isCrew && intentBadge && (
                    <span className={`ml-1 rounded border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${intentBadge.color}`}>
                      {intentBadge.label}
                    </span>
                  )}
                </div>

                <div
                  className={`max-w-[92%] rounded-xl p-3 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    isCrew
                      ? 'bg-cyan-950/40 border border-cyan-500/40 text-cyan-50 shadow-md'
                      : isRedFlag
                      ? 'bg-red-950/40 border-2 border-red-500/70 text-red-100 shadow-xl'
                      : 'bg-hud-panel/90 border border-hud-line text-hud-text shadow-md'
                  }`}
                >
                  {isRedFlag && (
                    <div className="mb-2 flex items-center gap-1.5 font-bold uppercase tracking-wider text-red-400 font-mono text-[11px] border-b border-red-500/30 pb-1">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                      Critical Red Flag Safety Notice
                    </div>
                  )}
                  {msg.text}
                </div>
              </div>
            );
          })}

          {/* Streaming In-Progress Message Bubble */}
          {isStreaming && (
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-hud-muted font-mono">
                <span>ARGUS Autonomous</span>
                <span>·</span>
                <span className="text-status-green font-semibold flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-ping" />
                  Streaming Clinical AI...
                </span>
              </div>
              <div className="max-w-[92%] rounded-xl p-3 text-xs leading-relaxed whitespace-pre-wrap break-words bg-hud-panel/90 border border-hud-accent/40 text-hud-text shadow-md">
                {streamingText || 'Synthesizing response from onboard clinical models...'}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="border-t border-hud-line bg-hud-bg/95 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            {speechRecognitionSupported && (
              <button
                type="button"
                onClick={toggleSpeechRecognition}
                aria-label={isListening ? 'Stop voice recording' : 'Start voice dictation'}
                title={isListening ? 'Listening (click to stop)' : 'Dictate message'}
                className={`hud-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  isListening
                    ? 'border-red-500/80 bg-red-500/20 text-red-400 animate-pulse'
                    : 'border-hud-line bg-hud-panel text-hud-muted hover:text-hud-text'
                }`}
              >
                {isListening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
            )}

            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask about readiness, vitals, symptoms, or radiation..."
              aria-label="Ask ARGUS Companion"
              disabled={isStreaming}
              className="hud-input flex-1 py-2 text-xs"
            />

            <button
              type="submit"
              disabled={!inputValue.trim() || isStreaming}
              aria-label="Send message"
              className="hud-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hud-accent/60 bg-hud-accent/20 text-hud-accent hover:bg-hud-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-2 flex items-center justify-between text-[10px] text-hud-muted px-1">
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3 text-cyan-400" />
              NASA HRP decision support · Never replaces Flight Surgeon
            </span>
            <span className="font-mono">
              Sol {checkInStreakDays > 0 ? checkInStreakDays : 1}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
