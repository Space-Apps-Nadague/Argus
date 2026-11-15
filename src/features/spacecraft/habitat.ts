/**
 * ARGUS — Spacecraft link (demo). ARGUS watches the cabin like a smart-home assistant watches a house:
 * when it detects a problem it changes the ship's systems itself (safe actions), asks the crew before
 * bigger ones, and says out loud what it saw and what it did.
 *
 * The spacecraft is SIMULATED here: systems, values and recovery curves are illustrative, not flight
 * data or flight rules. Three action tiers keep the crew in charge:
 *  - auto: safe and reversible (fans, scrubber rate); ARGUS does it and reports, the crew can undo.
 *  - confirm: significant (backup canister, isolating a module); ARGUS proposes, the crew confirms.
 *  - never: life-support shutdowns are never automated (not offered at all).
 */

export type SpacecraftEventId = 'co2_spike' | 'o2_low' | 'cabin_hot' | 'humidity_high' | 'pressure_leak';

export interface HabitatReading {
  label: string;
  unit: string;
  /** Spoken unit, e.g. "millimeters of mercury". */
  spokenUnit: string;
  /** Value when ARGUS detects the event. */
  value: number;
  /** Where ARGUS's actions bring it back to. */
  target: number;
  /** Seconds for most of the recovery (demo time, sped up). */
  recoverySec: number;
  /** Typical range, shown on the card. */
  nominal: string;
  decimals: number;
}

export interface HabitatAction {
  id: string;
  system: string;
  from: string;
  to: string;
  tier: 'auto' | 'confirm';
  /** How ARGUS says it: "set the CO2 scrubber to maximum". */
  say: string;
}

export interface SpacecraftEvent {
  id: SpacecraftEventId;
  title: string;
  module: string;
  severity: 'yellow' | 'red';
  reading: HabitatReading;
  /** Spoken detection, e.g. "Cabin CO2 jumped to 7.8 millimeters of mercury in the Lab." */
  detected: string;
  actions: HabitatAction[];
  /** What the crew should do. */
  advice: string[];
}

export const SPACECRAFT_EVENTS: Record<SpacecraftEventId, SpacecraftEvent> = {
  co2_spike: {
    id: 'co2_spike',
    title: 'CO₂ spike',
    module: 'Lab',
    severity: 'red',
    reading: { label: 'Cabin ppCO₂ (Lab)', unit: 'mmHg', spokenUnit: 'millimeters of mercury', value: 7.8, target: 3.0, recoverySec: 40, nominal: '2–3 mmHg', decimals: 1 },
    detected: 'Cabin CO2 jumped to 7.8 millimeters of mercury in the Lab, and three of you show faster breathing.',
    actions: [
      { id: 'scrubber', system: 'CO₂ scrubber', from: 'Nominal', to: 'Maximum', tier: 'auto', say: 'set the CO2 scrubber to maximum' },
      { id: 'fans', system: 'Lab fans', from: 'Normal', to: 'High', tier: 'auto', say: 'turned the Lab fans to high' },
      { id: 'ivv', system: 'Inter-module ventilation', from: 'Normal', to: 'Boost', tier: 'auto', say: 'boosted the air flow between modules' },
      { id: 'lioh', system: 'Backup LiOH canister', from: 'Stowed', to: 'Active', tier: 'confirm', say: 'start the backup lithium hydroxide canister' },
    ],
    advice: ['Move to Node 1 until CO₂ is below 4 mmHg.', 'Stop exercise in the Lab.', 'Report headache or shortness of breath.'],
  },
  o2_low: {
    id: 'o2_low',
    title: 'Oxygen dropping',
    module: 'Habitat',
    severity: 'yellow',
    reading: { label: 'Cabin O₂', unit: '%', spokenUnit: 'percent', value: 19.2, target: 21.0, recoverySec: 45, nominal: '20.5–21.5 %', decimals: 1 },
    detected: 'Cabin oxygen dropped to 19.2 percent in the Habitat module.',
    actions: [
      { id: 'o2gen', system: 'O₂ generator', from: 'Nominal', to: 'Boost', tier: 'auto', say: 'boosted the oxygen generator' },
      { id: 'o2tank', system: 'O₂ from high-pressure tanks', from: 'Closed', to: 'Open', tier: 'confirm', say: 'add oxygen from the high-pressure tanks' },
    ],
    advice: ['Avoid exercise until O₂ is back above 20.5 %.', 'Know where the nearest oxygen mask is.'],
  },
  cabin_hot: {
    id: 'cabin_hot',
    title: 'Cabin too hot',
    module: 'Node 2',
    severity: 'yellow',
    reading: { label: 'Cabin temperature (Node 2)', unit: '°C', spokenUnit: 'degrees Celsius', value: 29.4, target: 23.0, recoverySec: 50, nominal: '18–27 °C', decimals: 1 },
    detected: 'The cabin in Node 2 reached 29.4 degrees Celsius.',
    actions: [
      { id: 'cooling', system: 'Cooling loop flow', from: '60 %', to: '100 %', tier: 'auto', say: 'raised the cooling loop to full flow' },
      { id: 'fans', system: 'Node 2 fans', from: 'Normal', to: 'High', tier: 'auto', say: 'turned the Node 2 fans to high' },
    ],
    advice: ['Drink water.', 'Postpone exercise until it cools down.'],
  },
  humidity_high: {
    id: 'humidity_high',
    title: 'Humidity high',
    module: 'Habitat',
    severity: 'yellow',
    reading: { label: 'Relative humidity', unit: '%', spokenUnit: 'percent', value: 78, target: 50, recoverySec: 45, nominal: '25–70 %', decimals: 0 },
    detected: 'Humidity rose to 78 percent in the Habitat module.',
    actions: [{ id: 'chx', system: 'Condensing heat exchanger', from: 'Nominal', to: 'Maximum', tier: 'auto', say: 'set the condensing heat exchanger to maximum' }],
    advice: ['Wipe condensation from cold surfaces.', 'Check for a water leak near the galley.'],
  },
  pressure_leak: {
    id: 'pressure_leak',
    title: 'Slow pressure leak',
    module: 'Node 3',
    severity: 'red',
    reading: { label: 'Cabin pressure', unit: 'kPa', spokenUnit: 'kilopascals', value: 99.1, target: 101.0, recoverySec: 60, nominal: '99.9–102.7 kPa', decimals: 1 },
    detected: 'Cabin pressure is falling slowly, now 99.1 kilopascals. The pressure drop points to Node 3.',
    actions: [
      { id: 'log', system: 'Pressure monitoring', from: 'Every 10 min', to: 'Every 10 s', tier: 'auto', say: 'started fast pressure logging' },
      { id: 'repress', system: 'Repressurisation (N₂/O₂)', from: 'Off', to: 'On', tier: 'auto', say: 'started topping up the cabin air' },
      { id: 'hatch', system: 'Hatch to Node 3', from: 'Open', to: 'Closed', tier: 'confirm', say: 'close the hatch to Node 3 to isolate the leak' },
    ],
    advice: ['Leave Node 3 now.', 'Gather at the Soyuz/Dragon side.', 'Keep your comm on.'],
  },
};

export const SPACECRAFT_EVENT_IDS = Object.keys(SPACECRAFT_EVENTS) as SpacecraftEventId[];

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** What ARGUS says, e.g. "Cabin CO2 jumped to … I set the CO2 scrubber to maximum, … Please move to Node 1 … I need your OK to …" */
export function eventSpeech(ev: SpacecraftEvent, callsign?: string): string {
  const auto = ev.actions.filter((a) => a.tier === 'auto').map((a) => a.say);
  const confirm = ev.actions.filter((a) => a.tier === 'confirm').map((a) => a.say);
  const parts = [ev.detected];
  if (auto.length) parts.push(`I ${joinAnd(auto)}.`);
  if (ev.advice[0]) parts.push(`${callsign ? `${callsign}, please` : 'Please'} ${ev.advice[0].charAt(0).toLowerCase()}${ev.advice[0].slice(1)}`);
  if (confirm.length) parts.push(`Shall I ${joinAnd(confirm)}? Say confirm or cancel.`);
  return parts
    .join(' ')
    .replace(/CO₂/g, 'CO2')
    .replace(/O₂/g, 'oxygen')
    .replace(/(\d)\s*mmHg/g, '$1 millimeters of mercury')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/(\d)\s*°C/g, '$1 degrees Celsius')
    .replace(/(\d)\s*kPa/g, '$1 kilopascals')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Value of the reading t seconds after ARGUS acted: moves from `value` toward `target`
 * (exponential, 95 % of the way after `recoverySec`). Before acting (t ≤ 0) it is the detected value.
 */
export function valueAt(r: HabitatReading, t: number): number {
  if (t <= 0) return r.value;
  const k = 3 / r.recoverySec;
  const v = r.target + (r.value - r.target) * Math.exp(-k * t);
  return Number(v.toFixed(r.decimals));
}

/** Voice reply → intent (for "Say confirm or cancel"). */
export type VoiceIntent = 'confirm' | 'cancel' | 'undo' | 'status' | null;
export function parseVoiceIntent(transcript: string): VoiceIntent {
  const t = transcript.toLowerCase();
  if (/\b(undo|revert|put it back)\b/.test(t)) return 'undo';
  if (/\b(cancel|no|don'?t|decline|stop)\b/.test(t)) return 'cancel';
  if (/\b(confirm|yes|do it|go ahead|affirmative|ok(ay)?)\b/.test(t)) return 'confirm';
  if (/\b(status|what'?s|how much|level|reading)\b/.test(t)) return 'status';
  return null;
}

/** Spoken status line, e.g. "Lab CO2 is now 4.1 millimeters of mercury, coming down." */
export function statusSpeech(ev: SpacecraftEvent, current: number): string {
  const r = ev.reading;
  const label = r.label.replace('CO₂', 'CO2').replace('O₂', 'oxygen');
  const done = Math.abs(current - r.target) <= Math.abs(r.value - r.target) * 0.1;
  return `${label} is now ${current} ${r.spokenUnit}${done ? ', back in the normal range' : r.value > r.target ? ', coming down' : ', going up'}.`;
}
