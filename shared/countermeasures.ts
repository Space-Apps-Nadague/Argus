/**
 * Behavioural-health countermeasures the assistant can put on screen as a "do this now"
 * card (specs/04-ai-backend.md §4.4). Short, doable on a spacecraft, and drawn from the
 * NASA HRP behavioural-health countermeasure themes [SRC-104]: sleep hygiene, exercise,
 * family contact, crew cohesion, workload management and self-regulation skills.
 */

import type { CountermeasureSuggestion, MentalStateCueId } from '../src/types/assistant';

export const COUNTERMEASURES: CountermeasureSuggestion[] = [
  {
    id: 'box_breathing',
    kind: 'breathing',
    title: 'Slow breathing, 4 minutes',
    instruction: 'Breathe in for 4 seconds, hold 4, out for 4, hold 4. Keep going for four minutes and let your shoulders drop.',
    durationMinutes: 4,
  },
  {
    id: 'grounding',
    kind: 'grounding',
    title: 'Grounding reset',
    instruction: 'Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell and 1 you can taste. Go slowly.',
    durationMinutes: 3,
  },
  {
    id: 'sleep_winddown',
    kind: 'sleep',
    title: 'Wind-down before sleep',
    instruction: 'Dim your lights and stop screens 45 minutes before sleep, keep your sleep station cool and dark, and go to bed at the same time tonight.',
    durationMinutes: 45,
  },
  {
    id: 'move',
    kind: 'exercise',
    title: 'Move for 20 minutes',
    instruction: 'Do 20 minutes on the cycle or treadmill at an easy pace. You are not training, just changing your state.',
    durationMinutes: 20,
  },
  {
    id: 'talk_crewmate',
    kind: 'social',
    title: 'Talk to a crewmate',
    instruction: 'Pick one crewmate and share a meal or a coffee with them today. You do not have to bring up anything heavy.',
    durationMinutes: 20,
  },
  {
    id: 'call_home',
    kind: 'social',
    title: 'Message home',
    instruction: 'Record a short message for someone at home, or ask for a family conference at the next comm window.',
    durationMinutes: 10,
  },
  {
    id: 'workload_break',
    kind: 'workload',
    title: 'Take something off today',
    instruction: 'Choose one task that can wait and ask the Commander to move it. Take the freed time as a real break.',
    durationMinutes: 15,
  },
  {
    id: 'journal',
    kind: 'grounding',
    title: 'Write it down',
    instruction: 'Spend ten minutes writing what is on your mind in your crew journal. Nobody reads it but you.',
    durationMinutes: 10,
  },
  {
    id: 'fuel',
    kind: 'nutrition',
    title: 'Eat and drink',
    instruction: 'Have a full meal and half a litre of water in the next hour. Low fuel makes everything feel harder.',
    durationMinutes: 20,
  },
];

export function countermeasureById(id: string): CountermeasureSuggestion | undefined {
  return COUNTERMEASURES.find((c) => c.id === id);
}

const BY_CUE: Record<MentalStateCueId, string[]> = {
  anxiety: ['box_breathing', 'grounding'],
  stress: ['box_breathing', 'workload_break', 'move'],
  lowMood: ['move', 'talk_crewmate', 'journal'],
  hopelessness: ['talk_crewmate', 'call_home'],
  isolation: ['call_home', 'talk_crewmate'],
  conflict: ['journal', 'box_breathing'],
  sleepProblem: ['sleep_winddown', 'move'],
  lowMotivation: ['move', 'fuel'],
  fatigue: ['sleep_winddown', 'fuel'],
};

/** First countermeasure for the strongest cue that has not been suggested yet. */
export function pickCountermeasure(
  cues: Record<MentalStateCueId, number>,
  alreadySuggested: string[] = []
): CountermeasureSuggestion | null {
  const ranked = (Object.keys(cues) as MentalStateCueId[])
    .filter((id) => cues[id] >= 2)
    .sort((a, b) => cues[b] - cues[a]);
  for (const cue of ranked) {
    for (const id of BY_CUE[cue]) {
      if (!alreadySuggested.includes(id)) return countermeasureById(id) ?? null;
    }
  }
  return null;
}
