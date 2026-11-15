/**
 * Gemini prebuilt TTS voices and their style notes [SRC-106]. The same names work for the
 * Gemini Live session and the `/api/ai/tts` route.
 */

import type { VoiceOption } from '../../src/types/assistant';

const RAW: Array<[string, string]> = [
  ['Sulafat', 'Warm'],
  ['Vindemiatrix', 'Gentle'],
  ['Achernar', 'Soft'],
  ['Achird', 'Friendly'],
  ['Kore', 'Firm'],
  ['Charon', 'Informative'],
  ['Iapetus', 'Clear'],
  ['Erinome', 'Clear'],
  ['Schedar', 'Even'],
  ['Gacrux', 'Mature'],
  ['Sadaltager', 'Knowledgeable'],
  ['Rasalgethi', 'Informative'],
  ['Algieba', 'Smooth'],
  ['Despina', 'Smooth'],
  ['Aoede', 'Breezy'],
  ['Callirrhoe', 'Easy-going'],
  ['Umbriel', 'Easy-going'],
  ['Zubenelgenubi', 'Casual'],
  ['Orus', 'Firm'],
  ['Alnilam', 'Firm'],
  ['Enceladus', 'Breathy'],
  ['Algenib', 'Gravelly'],
  ['Zephyr', 'Bright'],
  ['Autonoe', 'Bright'],
  ['Puck', 'Upbeat'],
  ['Laomedeia', 'Upbeat'],
  ['Leda', 'Youthful'],
  ['Fenrir', 'Excitable'],
  ['Sadachbia', 'Lively'],
  ['Pulcherrima', 'Forward'],
];

export const GEMINI_VOICES: VoiceOption[] = RAW.map(([id, style]) => ({ id, label: id, engine: 'gemini', style }));

/** Warm rather than firm: the assistant is also the crew's therapist. */
export const DEFAULT_GEMINI_VOICE = 'Sulafat';

export function isGeminiVoice(id: string | undefined): id is string {
  return Boolean(id) && RAW.some(([name]) => name === id);
}
