/**
 * One deterministic red-flag detector for everything the crew types or says
 * (specs/04-ai-backend.md §5.1). It replaces the four separate detectors that used to
 * live in the companion brain, the symptom fallback, the voice client and the server.
 *
 * It runs before any model and its result can only be raised by a model, never lowered.
 * English and Hebrew (crew chat may be bilingual).
 */

export type RedFlagKind = 'crisis' | 'medical' | 'environmental';

/** Emergency protocol ids (`src/data/emergencyProtocols.ts`). */
export type RedFlagProtocolId = 'fire' | 'depress' | 'toxic' | 'medical' | 'radiation' | 'co2';

export interface RedFlagResult {
  /** Any red flag at all. */
  flagged: boolean;
  /** Self-harm or suicide language. */
  crisis: boolean;
  /** Acute medical danger (chest pain, cannot breathe, fainting, stroke signs…). */
  medical: boolean;
  /** Habitat danger (fire, pressure loss, toxic leak, radiation, CO₂). */
  environmental: boolean;
  /** Emergency protocol to open, when the text points at one. */
  protocolId: RedFlagProtocolId | null;
  /** The exact phrases that matched. */
  matched: string[];
}

export const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid/i,
  /\bkill(ing)?\s+my\s?self\b/i,
  /\bend(ing)?\s+(it\s+all|my\s+life)\b/i,
  /\b(hurt|harm|cut)(ing)?\s+my\s?self\b/i,
  /\bself[-\s]?harm/i,
  /\b(want|wish)(ed)?\s+(to\s+)?(die|be\s+dead)\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on)\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\bdon'?t\s+want\s+to\s+(live|be\s+alive|wake\s+up)\b/i,
  /להתאבד/,
  /התאבדות/,
  /אובדנ/,
  /לפגוע\s*בעצמי/,
  /רוצה\s*למות/,
  /אין\s*טעם\s*לחיות/,
];

const MEDICAL_PATTERNS: RegExp[] = [
  /\b(crushing\s+)?chest\s*(pain|pressure|tightness)\b/i,
  /\bheart\s*attack\b/i,
  /\bcan(?:'?t|\s*not|not)\s+breathe\b/i,
  /\b(short(ness)?\s+of\s+breath|difficult(y)?\s+breathing|dyspnea|choking)\b/i,
  /\b(faint(ed|ing)?|passed\s+out|unconscious|loss\s+of\s+consciousness|syncope|unresponsive)\b/i,
  /\b(seizure|convulsion)s?\b/i,
  /\b(stroke|paralysis|face\s+droop(ing)?|slurred\s+speech|speech\s+is\s+slurred|slurring)\b/i,
  /\b(sudden\s+blindness|loss\s+of\s+vision|lost\s+my\s+vision)\b/i,
  /\b(severe\s+)?(hemorrhage|haemorrhage)\b/i,
  /\b(bleeding\s+(heavily|badly|won'?t\s+stop)|severe\s+bleeding)\b/i,
  /\banaphyla/i,
  /כאב.{0,12}חזה/,
  /חזה.{0,12}כואב/,
  /קשה.{0,8}לנשום/,
  /קוצר\s*נשימה/,
  /התעלפ/,
];

const ENVIRONMENTAL_PATTERNS: Array<[RedFlagProtocolId, RegExp]> = [
  ['fire', /\b(fire|flames?|smoke|burning\s+smell|something('?s| is)\s+burning)\b/i],
  ['depress', /\b(depressuri[sz]|pressure\s+(is\s+)?(dropping|falling|loss)|losing\s+pressure|hull\s+breach|air\s+leak|hissing)\b/i],
  ['toxic', /\b(ammonia|toxic|chemical\s+(leak|spill|smell)|coolant\s+leak|fumes)\b/i],
  ['radiation', /\b(solar\s+(storm|flare|particle)|radiation\s+(alarm|storm|spike)|spe\s+alert)\b/i],
  ['co2', /\b(co2|carbon\s+dioxide)\s+(alarm|is\s+(high|rising|climbing)|spike|build-?up)\b/i],
  ['fire', /שריפה|עשן|אש\b/],
];

/** Phrases that mention a hazard word without reporting an emergency. */
const BENIGN_ENVIRONMENTAL = /\b(fire\s+(drill|protocol|procedure|extinguisher\s+check)|no\s+(fire|smoke)|radiation\s+dose|smoke\s+detector\s+test)\b/i;

function collect(patterns: RegExp[], text: string, into: string[]): boolean {
  let hit = false;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      hit = true;
      into.push(m[0]);
    }
  }
  return hit;
}

/** Scans one or more texts for red flags. */
export function detectRedFlags(...texts: Array<string | null | undefined>): RedFlagResult {
  const matched: string[] = [];
  let crisis = false;
  let medical = false;
  let environmental = false;
  let protocolId: RedFlagProtocolId | null = null;

  for (const text of texts) {
    if (!text) continue;
    if (collect(CRISIS_PATTERNS, text, matched)) crisis = true;
    if (collect(MEDICAL_PATTERNS, text, matched)) medical = true;
    if (!BENIGN_ENVIRONMENTAL.test(text)) {
      for (const [id, pattern] of ENVIRONMENTAL_PATTERNS) {
        const m = text.match(pattern);
        if (m) {
          environmental = true;
          matched.push(m[0]);
          protocolId ??= id;
        }
      }
    }
  }

  if (!protocolId && (medical || crisis)) protocolId = 'medical';
  return {
    flagged: crisis || medical || environmental,
    crisis,
    medical,
    environmental,
    protocolId,
    matched,
  };
}

/** Self-harm / suicide language only (kept for callers that need just the crisis flag). */
export function detectCrisisLanguage(...texts: Array<string | undefined>): { crisis: boolean; matched: string[] } {
  const matched: string[] = [];
  let crisis = false;
  for (const text of texts) {
    if (text && collect(CRISIS_PATTERNS, text, matched)) crisis = true;
  }
  return { crisis, matched };
}
