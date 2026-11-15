/**
 * Voice preferences for the ARGUS assistant, kept per browser
 * (specs/02-ui-dashboard.md §2.4).
 */

import type { VoiceEngineId } from '../../types/assistant';

export const VOICE_PREFS_KEY = 'argus_voice_prefs_v1';

export interface VoicePrefs {
  /** Speak replies aloud. */
  speak: boolean;
  /** Chosen voice id per engine. */
  voices: Partial<Record<VoiceEngineId, string>>;
  /** Speaking rate, 0.8–1.3. */
  rate: number;
  /** Listen continuously and send when the crew member stops talking. */
  handsFree: boolean;
  /** Start the camera with the console (after consent). */
  cameraOn: boolean;
  /** One-time consent to camera analysis. */
  cameraConsent: boolean;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  speak: true,
  voices: {},
  rate: 1,
  handsFree: false,
  cameraOn: true,
  cameraConsent: false,
};

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFS };
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      ...DEFAULT_VOICE_PREFS,
      ...parsed,
      voices: { ...(parsed.voices ?? {}) },
      rate: Math.min(1.3, Math.max(0.8, Number(parsed.rate) || 1)),
    };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: preferences last for this session only
  }
}
