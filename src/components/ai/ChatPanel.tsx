/**
 * ARGUS AI — Chat (specs/02-ui-dashboard.md §2.4, §5)
 * Streams `POST /api/ai/chat`. With the ARGUS database the server stores every message, linked to the
 * astronaut and the data the AI saw (specs/05-data-platform.md §3.5); offline, history is kept per crew
 * member in this browser (`argus_chat_v1`).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Send, Square, UserRound } from 'lucide-react';
import { useMission } from '../../context/MissionContext';
import type { AiResultMeta, CrewChatMessage, WellbeingCheckIn } from '../../types/aiApi';
import { streamCrewChat } from '../../services/argusApi';
import { chatHistoryApi } from '../../services/dataApi';
import { errorText, ErrorNote, SourceTag, useCrewContextRequest, usePerCrewList, useWellbeingHistory } from './shared';

export const CHAT_STORAGE_KEY = 'argus_chat_v1';

const SUGGESTIONS = ['How am I doing today?', 'Why is my readiness lower?', 'I feel stressed and tired', 'What should I do about my eyes?'];

export const ChatPanel: React.FC = () => {
  const { activeCrewMember, runtimeApiKey, serverBacked, canReadActiveCrew } = useMission();
  const ctx = useCrewContextRequest();
  const [localMessages, setLocalMessages] = usePerCrewList<CrewChatMessage>(CHAT_STORAGE_KEY, activeCrewMember.id);
  const [serverMessages, setServerMessages] = useState<CrewChatMessage[]>([]);
  const messages = serverBacked ? serverMessages : localMessages;
  const setMessages = serverBacked
    ? (fn: (prev: CrewChatMessage[]) => CrewChatMessage[]) => setServerMessages(fn)
    : setLocalMessages;

  useEffect(() => {
    if (!serverBacked || !canReadActiveCrew) return;
    let alive = true;
    setError(null);
    setServerMessages([]);
    chatHistoryApi
      .latest(activeCrewMember.id)
      .then((r) => alive && setServerMessages(r.messages))
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [serverBacked, canReadActiveCrew, activeCrewMember.id]);

  const clearChat = () => {
    if (serverBacked) {
      if (!canReadActiveCrew) return;
      chatHistoryApi
        .startNew(activeCrewMember.id)
        .then(() => setServerMessages([]))
        .catch((err) => setError(errorText(err)));
      return;
    }
    setLocalMessages(() => []);
  };
  const [checkIns] = useWellbeingHistory(activeCrewMember.id);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<AiResultMeta | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, streaming]);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const userMsg: CrewChatMessage = { role: 'user', content, timestampIso: new Date().toISOString() };
    const history = [...messages, userMsg];
    setMessages(() => history);
    setInput('');
    setBusy(true);
    setError(null);
    setStreaming('');
    setCrisis(false);
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';
    try {
      await streamCrewChat(
        { ...ctx, messages: history.slice(-20).map(({ role, content: c }) => ({ role, content: c })), checkIns },
        (ev) => {
          if (ev.type === 'meta') {
            setMeta(ev.meta);
            setCrisis(ev.crisis);
          } else if (ev.type === 'delta') {
            reply += ev.text;
            setStreaming(reply);
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        },
        { runtimeApiKey, signal: controller.signal }
      );
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err));
    } finally {
      if (reply) setMessages((prev) => [...prev, { role: 'assistant', content: reply, timestampIso: new Date().toISOString() }]);
      setStreaming('');
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-[min(70vh,720px)] min-h-[420px] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-hud-line pb-2">
        <SourceTag meta={meta} />
        <button
          type="button"
          className="hud-btn ml-auto"
          onClick={clearChat}
          disabled={busy || messages.length === 0}
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          Clear chat
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-3" aria-live="polite">
        {messages.length === 0 && !streaming && (
          <div className="mx-auto max-w-md py-8 text-center">
            <Bot className="mx-auto h-8 w-8 text-hud-accent" aria-hidden="true" />
            <p className="mt-2 text-sm text-hud-text">Hi {activeCrewMember.callsign}. Ask me about your health data, symptoms or how you feel.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="hud-btn" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} />
        ))}
        {streaming && <Bubble role="assistant" text={streaming} crisis={crisis} />}
        {busy && !streaming && <p className="text-xs text-hud-muted">ARGUS is thinking… (a local model can take 10–30 s)</p>}
        <div ref={endRef} />
      </div>

      <ErrorNote error={error} />

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="argus-chat-input" className="sr-only">
          Message ARGUS
        </label>
        <textarea
          id="argus-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Message ARGUS…  (Enter to send, Shift+Enter for a new line)"
          className="hud-input flex-1 resize-none font-sans"
        />
        {busy ? (
          <button type="button" className="hud-btn self-stretch" onClick={() => abortRef.current?.abort()} aria-label="Stop">
            <Square className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="hud-btn-primary self-stretch" disabled={!input.trim()} aria-label="Send">
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>
      <p className="mt-1 text-[11px] text-hud-muted">ARGUS is decision support, not a doctor. In an emergency use the SOS tab.</p>
    </div>
  );
};

const Bubble: React.FC<{ role: CrewChatMessage['role']; text: string; crisis?: boolean }> = ({ role, text, crisis }) => {
  const mine = role === 'user';
  return (
    <div className={`flex gap-2 ${mine ? 'justify-end' : ''}`}>
      {!mine && <Bot className="mt-1 h-5 w-5 shrink-0 text-hud-accent" aria-hidden="true" />}
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${
          mine
            ? 'bg-hud-accent/15 text-hud-text'
            : crisis
              ? 'border border-red-500/60 bg-red-950/40 text-red-50'
              : 'border border-hud-line bg-hud-bg/70 text-hud-text'
        }`}
      >
        <span className="sr-only">{mine ? 'You: ' : 'ARGUS: '}</span>
        {text}
      </div>
      {mine && <UserRound className="mt-1 h-5 w-5 shrink-0 text-hud-muted" aria-hidden="true" />}
    </div>
  );
};
