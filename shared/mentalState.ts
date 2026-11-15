/**
 * Deterministic mental-state assessment (specs/04-ai-backend.md §4.4).
 *
 * Signals come from four places: what the crew member says, what the camera sees,
 * their self-report check-ins, and physiology already in the snapshot. A language model
 * may add cue strengths, but the concern level is computed here, in code: a model can
 * raise a cue, never lower one, and crisis language is always `urgent`.
 *
 * This is screening to decide when to check in, what to suggest and what to tell the
 * doctors on Earth. It is not a diagnosis.
 */

import type {
  ConcernLevel,
  MentalStateAssessment,
  MentalStateCueId,
  MentalStateCues,
  MentalStateEvidence,
  ObservedLevel,
  VisualObservation,
} from '../src/types/assistant';
import type { EarthConsultUrgency } from '../src/types/aiApi';
import { detectCrisisLanguage } from './redFlags';

export const CUE_IDS: MentalStateCueId[] = [
  'lowMood',
  'stress',
  'anxiety',
  'sleepProblem',
  'isolation',
  'conflict',
  'lowMotivation',
  'hopelessness',
  'fatigue',
];

export const CUE_LABELS: Record<MentalStateCueId, string> = {
  lowMood: 'Low mood',
  stress: 'Stress',
  anxiety: 'Anxiety',
  sleepProblem: 'Sleep trouble',
  isolation: 'Isolation',
  conflict: 'Crew conflict',
  lowMotivation: 'Low motivation',
  hopelessness: 'Hopelessness',
  fatigue: 'Fatigue',
};

/** How much each cue moves the 0–100 concern score. */
export const CUE_WEIGHTS: Record<MentalStateCueId, number> = {
  hopelessness: 5,
  lowMood: 4,
  anxiety: 3,
  stress: 3,
  isolation: 3,
  sleepProblem: 2.5,
  lowMotivation: 2.5,
  conflict: 2,
  fatigue: 2,
};

/** Score cut-offs for the concern level (design values, reviewed with the spec). */
export const CONCERN_THRESHOLDS = { watch: 12, concern: 30 } as const;

const CONCERN_RANK: Record<ConcernLevel, number> = { none: 0, watch: 1, concern: 2, urgent: 3 };

export function maxConcern(a: ConcernLevel, b: ConcernLevel): ConcernLevel {
  return CONCERN_RANK[a] >= CONCERN_RANK[b] ? a : b;
}

export function emptyCues(): MentalStateCues {
  return {
    lowMood: 0,
    stress: 0,
    anxiety: 0,
    sleepProblem: 0,
    isolation: 0,
    conflict: 0,
    lowMotivation: 0,
    hopelessness: 0,
    fatigue: 0,
  };
}

const clampCue = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.min(3, Math.max(0, v));
};

/** Cue-wise maximum: the only way cue sets are ever combined. */
export function mergeCues(...sets: Array<Partial<MentalStateCues> | null | undefined>): MentalStateCues {
  const out = emptyCues();
  for (const set of sets) {
    if (!set) continue;
    for (const id of CUE_IDS) out[id] = Math.max(out[id], clampCue(set[id]));
  }
  return out;
}

// ── Conversation lexicon (works with no model at all) ────────────────────────

interface LexiconEntry {
  cue: MentalStateCueId;
  strength: 1 | 2 | 3;
  pattern: RegExp;
}

const LEXICON: LexiconEntry[] = [
  { cue: 'hopelessness', strength: 3, pattern: /\b(hopeless|no\s+point|pointless|what'?s\s+the\s+point|nothing\s+matters|can'?t\s+do\s+this\s+anymore|give\s+up|giving\s+up|no\s+way\s+out)\b/i },
  { cue: 'hopelessness', strength: 2, pattern: /\b(never\s+get(s|ting)?\s+better|trapped|stuck\s+here\s+forever|worthless|a\s+burden)\b/i },
  { cue: 'lowMood', strength: 3, pattern: /\b(depress(ed|ing|ion)|miserable|devastated|empty\s+inside|numb|crying\s+(a\s+lot|all\s+the\s+time|every))\b/i },
  { cue: 'lowMood', strength: 2, pattern: /\b(sad|down|low|unhappy|blue|tearful|cried|crying|heartbroken|grieving|homesick)\b/i },
  { cue: 'lowMood', strength: 1, pattern: /\b(meh|not\s+great|not\s+myself|off\s+today|flat)\b/i },
  { cue: 'stress', strength: 3, pattern: /\b(overwhelmed|can'?t\s+cope|breaking\s+point|burn(ed|t)\s*out|burnout|at\s+my\s+limit)\b/i },
  { cue: 'stress', strength: 2, pattern: /\b(stress(ed|ful)?|under\s+pressure|too\s+much\s+(work|to\s+do)|swamped|tense|on\s+edge|frustrated|irritable|snapped)\b/i },
  { cue: 'anxiety', strength: 3, pattern: /\b(panic(king|ked)?(\s+attack)?|terrified|dread|can'?t\s+stop\s+worrying)\b/i },
  { cue: 'anxiety', strength: 2, pattern: /\b(anxious|anxiety|worried|worrying|scared|afraid|nervous|racing\s+thoughts|uneasy)\b/i },
  { cue: 'sleepProblem', strength: 3, pattern: /\b(haven'?t\s+slept|no\s+sleep|insomnia|awake\s+all\s+night)\b/i },
  { cue: 'sleepProblem', strength: 2, pattern: /\b(can'?t\s+sleep|couldn'?t\s+sleep|trouble\s+sleeping|sleep(ing)?\s+(badly|poorly|terribly)|bad\s+sleep|nightmares?|wak(e|ing)\s+up\s+(a\s+lot|at\s+night|early)|barely\s+slept)\b/i },
  { cue: 'isolation', strength: 3, pattern: /\b(completely\s+alone|no\s+one\s+(cares|understands|to\s+talk\s+to)|nobody\s+(cares|understands))\b/i },
  { cue: 'isolation', strength: 2, pattern: /\b(lonely|alone|isolated|cut\s+off|miss(ing)?\s+(my\s+)?(family|home|wife|husband|partner|kids|children|friends|earth)|far\s+from\s+home)\b/i },
  { cue: 'conflict', strength: 2, pattern: /\b(argu(ed|ing|ment)|fight(ing)?\s+with|fought\s+with|conflict|can'?t\s+stand|angry\s+(at|with)|furious|resent|tension\s+with|not\s+speaking\s+to)\b/i },
  { cue: 'lowMotivation', strength: 2, pattern: /\b(no\s+motivation|unmotivated|don'?t\s+(care|feel\s+like)|can'?t\s+be\s+bothered|lost\s+interest|no\s+energy\s+for|skipp(ed|ing)\s+(my\s+)?(exercise|workout|meals?))\b/i },
  { cue: 'fatigue', strength: 3, pattern: /\b(exhausted|drained|wiped\s+out|can\s+barely\s+(move|think|keep\s+my\s+eyes\s+open))\b/i },
  { cue: 'fatigue', strength: 2, pattern: /\b(tired|fatigued?|worn\s+out|sleepy|no\s+energy|sluggish|foggy|can'?t\s+(focus|concentrate))\b/i },
  // Hebrew
  { cue: 'lowMood', strength: 2, pattern: /עצוב|מדוכא|בדיכאון|רע\s*לי/ },
  { cue: 'stress', strength: 2, pattern: /לחוץ|לחוצה|בלחץ|מוצף|מוצפת/ },
  { cue: 'anxiety', strength: 2, pattern: /חרד|מפחד|מפחדת|דואג|דואגת/ },
  { cue: 'isolation', strength: 2, pattern: /בודד|בודדה|מתגעגע|מתגעגעת|לבד/ },
  { cue: 'fatigue', strength: 2, pattern: /עייף|עייפה|מותש|מותשת/ },
  { cue: 'sleepProblem', strength: 2, pattern: /לא\s*(ישנתי|מצליח\s*לישון|מצליחה\s*לישון)/ },
  { cue: 'hopelessness', strength: 3, pattern: /אין\s*טעם|חסר\s*תקווה/ },
];

const POSITIVE = /\b(feel(ing)?\s+(good|great|better|fine|ok|okay|happy|calm|rested)|doing\s+(well|good|great|fine|ok|okay)|slept\s+well|in\s+a\s+good\s+mood|that\s+helped|much\s+better)\b/i;

/** Negation just before a cue word ("not stressed", "no longer anxious") cancels that hit. */
function negated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index).toLowerCase();
  return /\b(not|no\s+longer|never|isn'?t|aren'?t|wasn'?t|don'?t\s+feel|didn'?t\s+feel|less)\s+(\w+\s+)?$/.test(before);
}

export interface TextCueResult {
  cues: MentalStateCues;
  evidence: MentalStateEvidence[];
  positive: boolean;
}

/**
 * Extracts cues from the crew member's recent messages, newest last. Older messages count
 * one step weaker so a hard moment fades unless it comes up again.
 */
export function extractCuesFromText(messages: string[]): TextCueResult {
  const cues = emptyCues();
  const evidence: MentalStateEvidence[] = [];
  const recent = messages.slice(-8);
  let positive = false;

  recent.forEach((text, i) => {
    const age = recent.length - 1 - i; // 0 = latest
    const fade = age >= 4 ? 2 : age >= 2 ? 1 : 0;
    if (age <= 1 && POSITIVE.test(text)) positive = true;
    for (const entry of LEXICON) {
      const m = entry.pattern.exec(text);
      if (!m || negated(text, m.index)) continue;
      const strength = Math.max(0, entry.strength - fade);
      if (strength > cues[entry.cue]) {
        cues[entry.cue] = strength;
        const quote = text.length > 140 ? `${text.slice(0, 137)}…` : text;
        if (!evidence.some((e) => e.text === `"${quote}"`)) {
          evidence.push({ source: 'conversation', text: `"${quote}"` });
        }
      }
    }
  });

  return { cues, evidence: evidence.slice(-4), positive };
}

// ── Camera ───────────────────────────────────────────────────────────────────

const LEVEL_TO_CUE: Record<ObservedLevel, number> = { low: 0, moderate: 1, high: 2 };

/** Camera signals can suggest fatigue or tension. They are capped at 2: looks alone are never "strong". */
export function cuesFromObservation(obs: VisualObservation | null | undefined): {
  cues: Partial<MentalStateCues>;
  evidence: MentalStateEvidence[];
} {
  if (!obs || !obs.facePresent) return { cues: {}, evidence: [] };
  const cues: Partial<MentalStateCues> = {};
  const evidence: MentalStateEvidence[] = [];
  if (obs.fatigue && obs.fatigue !== 'low') {
    cues.fatigue = LEVEL_TO_CUE[obs.fatigue];
    const parts = [
      obs.perclos != null ? `eyes closed ${Math.round(obs.perclos * 100)}% of the time` : '',
      obs.yawnsPerMin ? `${obs.yawnsPerMin.toFixed(1)} yawns/min` : '',
    ].filter(Boolean);
    evidence.push({ source: 'camera', text: `Looks ${obs.fatigue === 'high' ? 'very ' : ''}tired${parts.length ? ` (${parts.join(', ')})` : ''}` });
  }
  if (obs.affect === 'tense') {
    cues.stress = 1;
    evidence.push({ source: 'camera', text: 'Tense expression' });
  }
  if (obs.affect === 'flat') {
    cues.lowMood = 1;
    evidence.push({ source: 'camera', text: 'Flat expression' });
  }
  if (obs.restlessness === 'high') {
    cues.anxiety = 1;
    evidence.push({ source: 'camera', text: 'Restless, moving a lot' });
  }
  if (obs.posture === 'slumped') {
    cues.fatigue = Math.max(cues.fatigue ?? 0, 1);
    evidence.push({ source: 'camera', text: 'Slumped posture' });
  }
  return { cues, evidence };
}

// ── Combiner ─────────────────────────────────────────────────────────────────

export interface SelfReportInput {
  /** 0–100 from the wellbeing model. */
  riskScore: number;
  status: 'green' | 'yellow' | 'red';
  trend: 'improving' | 'stable' | 'worsening';
}

export interface PhysiologyInput {
  /** Behavioral zone status from deterministic triage. */
  behavioralStatus?: 'green' | 'yellow' | 'red';
  /** Labels of flagged sleep / HRV / mood metrics, e.g. "Sleep efficiency 71 %". */
  flagged?: string[];
}

export interface CombineInput {
  /** The crew member's messages, oldest first. */
  userMessages: string[];
  /** Cue strengths proposed by a language model (may only raise). */
  modelCues?: Partial<MentalStateCues> | null;
  /** The model's one-line read, used as the summary when present. */
  modelSummary?: string | null;
  observation?: VisualObservation | null;
  selfReport?: SelfReportInput | null;
  physiology?: PhysiologyInput | null;
  previous?: MentalStateAssessment | null;
  now?: Date;
}

export function scoreCues(cues: MentalStateCues): number {
  let sum = 0;
  let max = 0;
  for (const id of CUE_IDS) {
    sum += cues[id] * CUE_WEIGHTS[id];
    max += 3 * CUE_WEIGHTS[id];
  }
  return Math.round((sum / max) * 100);
}

function levelFromCue(n: number): ObservedLevel {
  return n >= 2 ? 'high' : n === 1 ? 'moderate' : 'low';
}

function defaultSummary(level: ConcernLevel, cues: MentalStateCues): string {
  const top = CUE_IDS.filter((id) => cues[id] >= 2)
    .sort((a, b) => cues[b] * CUE_WEIGHTS[b] - cues[a] * CUE_WEIGHTS[a])
    .slice(0, 3)
    .map((id) => CUE_LABELS[id].toLowerCase());
  if (level === 'urgent') return 'Crisis language detected. Immediate human contact is needed.';
  if (!top.length) {
    return level === 'none' ? 'No signs of concern right now.' : 'A few mild signs worth keeping an eye on.';
  }
  const lead = level === 'concern' ? 'Signs of real strain' : 'Some signs of strain';
  return `${lead}: ${top.join(', ')}.`;
}

/** Fuses every signal into one assessment. Pure and deterministic. */
export function combineAssessment(input: CombineInput): MentalStateAssessment {
  const text = extractCuesFromText(input.userMessages);
  const camera = cuesFromObservation(input.observation);
  const evidence: MentalStateEvidence[] = [...text.evidence, ...camera.evidence];

  const physio: Partial<MentalStateCues> = {};
  if (input.physiology?.behavioralStatus === 'red') {
    physio.sleepProblem = 2;
    physio.fatigue = 2;
  } else if (input.physiology?.behavioralStatus === 'yellow') {
    physio.sleepProblem = 1;
    physio.fatigue = 1;
  }
  for (const label of input.physiology?.flagged?.slice(0, 3) ?? []) {
    evidence.push({ source: 'physiology', text: label });
  }

  const cues = mergeCues(text.cues, camera.cues, physio, input.modelCues);
  let score = scoreCues(cues);

  let level: ConcernLevel = 'none';
  if (score >= CONCERN_THRESHOLDS.concern) level = 'concern';
  else if (score >= CONCERN_THRESHOLDS.watch) level = 'watch';

  // Floors that no score or model can undercut.
  if (cues.hopelessness >= 2) level = maxConcern(level, 'concern');
  if (cues.lowMood >= 3) level = maxConcern(level, 'concern');
  if (input.selfReport) {
    if (input.selfReport.status === 'red') level = maxConcern(level, 'concern');
    else if (input.selfReport.status === 'yellow') level = maxConcern(level, 'watch');
    score = Math.max(score, Math.round(input.selfReport.riskScore * 0.8));
    if (input.selfReport.status !== 'green') {
      evidence.push({
        source: 'self_report',
        text: `Check-in risk ${Math.round(input.selfReport.riskScore)}/100, ${input.selfReport.trend}`,
      });
    }
  }
  if (detectCrisisLanguage(...input.userMessages.slice(-3)).crisis) {
    level = 'urgent';
    score = 100;
  }

  const previous = input.previous ?? null;
  let trend: MentalStateAssessment['trend'] = 'stable';
  if (previous) {
    if (score - previous.score >= 8) trend = 'worsening';
    else if (previous.score - score >= 8) trend = 'improving';
  } else if (input.selfReport && input.selfReport.trend !== 'stable') {
    trend = input.selfReport.trend;
  }

  const mood: MentalStateAssessment['mood'] =
    cues.lowMood >= 3 || cues.hopelessness >= 2
      ? 'very_low'
      : cues.lowMood === 2
        ? 'low'
        : text.positive && cues.lowMood === 0
          ? 'good'
          : 'ok';

  const modelSummary = input.modelSummary?.trim();
  return {
    assessedAtIso: (input.now ?? new Date()).toISOString(),
    cues,
    mood,
    stress: levelFromCue(Math.max(cues.stress, cues.anxiety)),
    fatigue: levelFromCue(Math.max(cues.fatigue, cues.sleepProblem >= 2 ? cues.sleepProblem - 1 : 0)),
    concernLevel: level,
    score,
    trend,
    evidence: evidence.slice(0, 8),
    summary: level !== 'urgent' && modelSummary ? modelSummary.slice(0, 400) : defaultSummary(level, cues),
  };
}

// ── Reporting to Earth ───────────────────────────────────────────────────────

export type ReportTiming = 'immediate' | 'auto' | 'digest';

/**
 * When a behavioural-health report goes to the doctors on Earth
 * (specs/04-ai-backend.md §4.4): urgent → now, concern → automatic with a notice to the
 * crew member, anything else → the daily digest.
 */
export function reportTimingFor(level: ConcernLevel): ReportTiming {
  if (level === 'urgent') return 'immediate';
  if (level === 'concern') return 'auto';
  return 'digest';
}

export function urgencyForConcern(level: ConcernLevel): EarthConsultUrgency {
  if (level === 'urgent') return 'immediate_emergency_packet';
  if (level === 'concern') return 'priority_packet';
  return 'routine_downlink';
}

/** True when a new report should be sent: the level rose, or first time at concern or above. */
export function shouldAutoReport(current: ConcernLevel, lastReported: ConcernLevel | null): boolean {
  if (reportTimingFor(current) === 'digest') return false;
  return lastReported === null || CONCERN_RANK[current] > CONCERN_RANK[lastReported];
}
