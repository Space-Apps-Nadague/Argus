/**
 * Comm tier: how far the crew is from Earth decides which AI stack answers
 * (specs/04-ai-backend.md §4.2). One module shared by the HUD and the server so both
 * always agree on the tier.
 *
 * - `live`       Earth / LEO: delay is below conversational limits, so a full-duplex
 *                cloud session (Gemini Live) feels natural.
 * - `relay`      cislunar: a 2–3 s round trip breaks full duplex, but streamed
 *                turn-by-turn cloud calls still beat local models.
 * - `autonomous` deep space, blackout or no network: everything runs on the ship
 *                (local LLM, local STT/TTS); Earth is reached by store-and-forward packets.
 *
 * Cut-offs: ITU-T G.114 puts acceptable one-way mouth-to-ear delay at ≤ 400 ms [SRC-100];
 * above ~5 s one-way even turn-taking with Earth is slower than a local model's reply.
 */

export type CommTier = 'live' | 'relay' | 'autonomous';

export const COMM_TIERS: CommTier[] = ['live', 'relay', 'autonomous'];

export const COMM_TIER_LIMITS = {
  /** One-way seconds at or below which a full-duplex Earth session is used [SRC-100]. */
  liveMaxOneWaySec: 0.4,
  /** One-way seconds at or below which turn-by-turn Earth cloud calls are used. */
  relayMaxOneWaySec: 5,
} as const;

export interface CommTierInput {
  /** Live one-way light time to Earth in seconds (`commDelayAt`). */
  oneWayDelaySec: number;
  /** False when the browser or server has no network path to Earth. */
  online?: boolean;
  /** Crew- or test-selected tier ("comm blackout" = `autonomous`). */
  override?: CommTier | null;
}

export function isCommTier(value: unknown): value is CommTier {
  return typeof value === 'string' && (COMM_TIERS as string[]).includes(value);
}

/** Tier from distance alone. */
export function tierForDelay(oneWayDelaySec: number): CommTier {
  if (!Number.isFinite(oneWayDelaySec) || oneWayDelaySec < 0) return 'autonomous';
  if (oneWayDelaySec <= COMM_TIER_LIMITS.liveMaxOneWaySec) return 'live';
  if (oneWayDelaySec <= COMM_TIER_LIMITS.relayMaxOneWaySec) return 'relay';
  return 'autonomous';
}

const TIER_RANK: Record<CommTier, number> = { live: 0, relay: 1, autonomous: 2 };

/** The more self-reliant of two tiers. */
export function mostAutonomous(a: CommTier, b: CommTier): CommTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/**
 * Resolves the active tier. An override can only move the crew *away* from Earth
 * dependence: physics still forbids a live session from Mars.
 */
export function resolveCommTier(input: CommTierInput): CommTier {
  if (input.online === false) return 'autonomous';
  const physical = tierForDelay(input.oneWayDelaySec);
  return input.override ? mostAutonomous(physical, input.override) : physical;
}

/** Next tier to try when the current one fails (`null` = only the rule-based brain is left). */
export function downgradeTier(tier: CommTier): CommTier | null {
  if (tier === 'live') return 'relay';
  if (tier === 'relay') return 'autonomous';
  return null;
}

export type SpeechEngineId = 'live' | 'cloud' | 'local' | 'browser';

export interface CommTierProfile {
  tier: CommTier;
  label: string;
  /** One line shown under the tier badge. */
  summary: string;
  /** Where the language model runs. */
  llm: 'earth-live' | 'earth-cloud' | 'on-ship';
  /** Speech engines in the order they are tried. */
  stt: SpeechEngineId[];
  tts: SpeechEngineId[];
  /** Milliseconds between camera frames sent to the model; `null` = one still per turn. */
  frameIntervalMs: number | null;
  /** Largest frame edge sent to the model, px. */
  frameMaxEdgePx: number;
  /** Chat turns of history sent with each request. */
  historyTurns: number;
  /** Whether Earth doctors are reached in real time or by queued packet. */
  earthLink: 'real-time' | 'store-and-forward';
}

export const COMM_TIER_PROFILES: Record<CommTier, CommTierProfile> = {
  live: {
    tier: 'live',
    label: 'Earth live',
    summary: 'Full-duplex session with Earth AI. Live video and voice.',
    llm: 'earth-live',
    stt: ['live', 'cloud', 'local', 'browser'],
    tts: ['live', 'cloud', 'local', 'browser'],
    frameIntervalMs: 1000,
    frameMaxEdgePx: 768,
    historyTurns: 30,
    earthLink: 'real-time',
  },
  relay: {
    tier: 'relay',
    label: 'Earth relay',
    summary: 'Turn-by-turn with Earth AI. Camera frame with each turn.',
    llm: 'earth-cloud',
    stt: ['cloud', 'local', 'browser'],
    tts: ['cloud', 'local', 'browser'],
    frameIntervalMs: 12_000,
    frameMaxEdgePx: 768,
    historyTurns: 24,
    earthLink: 'real-time',
  },
  autonomous: {
    tier: 'autonomous',
    label: 'On-ship',
    summary: 'Everything runs on the ship. Earth gets queued reports.',
    llm: 'on-ship',
    stt: ['local', 'browser'],
    tts: ['local', 'browser'],
    frameIntervalMs: null,
    frameMaxEdgePx: 512,
    historyTurns: 12,
    earthLink: 'store-and-forward',
  },
};

/** Round-trip seconds before an answer from Earth can arrive. */
export function roundTripSeconds(oneWayDelaySec: number): number {
  return Math.max(0, oneWayDelaySec) * 2;
}
