/**
 * ARGUS — Return to Earth: a personal recovery plan for each astronaut after landing.
 *
 * Modelled on NASA's post-flight reconditioning: it starts on landing day, runs 45 days (about two hours
 * a day) and is tailored to each astronaut; it starts with walking, heart and blood-pressure tolerance,
 * strength, balance and flexibility, then progresses toward the pre-flight baseline (NTRS 20110020318).
 * ARGUS personalises it from the mission data: bone loss, eye (SANS) changes, heart rate and blood pressure,
 * radiation dose, immune counts, sleep and mood. Phase lengths, thresholds and tasks are ARGUS choices for
 * decision support; the flight surgeon and the reconditioning specialists adjust the real plan.
 */
import type { CrewMemberProfile, VitalSignReading } from '../../types/argus';

export const RECOVERY_DAYS = 45;

export type FindingStatus = 'red' | 'yellow' | 'green';

export interface RecoveryTask {
  id: string;
  title: string;
  detail: string;
  minutes: number;
  /** First and last plan day (0 = landing day) this task is on the list. */
  from: number;
  to: number;
  /** Which finding added it (empty for the base programme). */
  forFinding?: string;
}

export interface RecoveryFinding {
  id: 'bone' | 'eyes' | 'heart' | 'radiation' | 'immune' | 'sleep_mind' | 'muscle' | 'balance';
  title: string;
  status: FindingStatus;
  /** "Bone density −2.4 % vs pre-flight". */
  summary: string;
  /** Typical time back to baseline (varies). */
  outlook: string;
  tasks: RecoveryTask[];
}

export interface RecoveryPhase {
  id: string;
  title: string;
  from: number;
  to: number;
  goal: string;
}

export interface Checkpoint {
  day: number;
  title: string;
  tests: string[];
}

export interface RecoveryPlan {
  crewId: string;
  missionDays: number;
  phases: RecoveryPhase[];
  findings: RecoveryFinding[];
  baseTasks: RecoveryTask[];
  checkpoints: Checkpoint[];
}

const latest = (rs: VitalSignReading[], id: string) => rs.find((r) => r.metricId === id);
const fmt = (v: number, d = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(d));

/** Builds the 45-day plan from the crew profile and the latest mission readings (all zones flattened). */
export function buildRecoveryPlan(crew: CrewMemberProfile, readings: VitalSignReading[], missionDays = crew.missionDaysLogged): RecoveryPlan {
  // Longer missions get a longer first phase.
  const p1End = missionDays >= 180 ? 5 : 3;
  const phases: RecoveryPhase[] = [
    { id: 'stand', title: 'Stand again', from: 0, to: p1End, goal: 'Walk safely, tolerate standing, settle the inner ear.' },
    { id: 'rebuild', title: 'Rebuild', from: p1End + 1, to: 14, goal: 'Heart endurance, strength and balance back toward normal daily life.' },
    { id: 'baseline', title: 'Back to baseline', from: 15, to: RECOVERY_DAYS - 1, goal: 'Reach (or beat) your pre-flight fitness and test results.' },
  ];

  const baseTasks: RecoveryTask[] = [
    { id: 'walk_spotter', title: 'Walk with a spotter', detail: 'Short walks, hand on a rail or a person. Stop if dizzy.', minutes: 15, from: 0, to: p1End },
    { id: 'sit_stand', title: 'Slow sit-to-stand', detail: 'Count to 5 before standing up; legs crossed and tense if lightheaded.', minutes: 5, from: 0, to: p1End },
    { id: 'fluids', title: 'Fluids as prescribed', detail: 'Drink the fluids and salt the flight surgeon ordered; wear the compression garment.', minutes: 0, from: 0, to: p1End },
    { id: 'balance_basic', title: 'Balance drills', detail: 'Stand with feet together, then on one foot, eyes open, next to a wall.', minutes: 10, from: 1, to: 14 },
    { id: 'bike', title: 'Stationary bike', detail: 'Easy pace, build up 5 minutes every few days.', minutes: 20, from: p1End + 1, to: 14 },
    { id: 'strength_body', title: 'Body-weight strength', detail: 'Squats to a chair, wall push-ups, bridges. 2 sets of 10.', minutes: 20, from: p1End + 1, to: 14 },
    { id: 'pool', title: 'Pool walking', detail: 'Water supports you while legs and balance come back.', minutes: 20, from: 7, to: 21 },
    { id: 'strength_load', title: 'Progressive resistance', detail: 'Gym weights, adding load each week as your coach approves.', minutes: 40, from: 15, to: RECOVERY_DAYS - 1 },
    { id: 'run', title: 'Run / agility (when cleared)', detail: 'Jog, then ladders and direction changes once balance tests are normal.', minutes: 30, from: 21, to: RECOVERY_DAYS - 1 },
    { id: 'no_drive', title: 'No driving yet', detail: 'Wait for the flight surgeon to clear balance and reaction time.', minutes: 0, from: 0, to: 14 },
  ];

  const findings: RecoveryFinding[] = [];

  const bmd = latest(readings, 'bmd_delta');
  if (bmd) {
    const loss = -bmd.currentValue;
    const status: FindingStatus = loss >= 2 ? 'red' : loss >= 1 ? 'yellow' : 'green';
    findings.push({
      id: 'bone',
      title: 'Bone',
      status,
      summary: `Bone density ${bmd.currentValue > 0 ? '+' : ''}${fmt(bmd.currentValue)} % vs pre-flight.`,
      outlook: status === 'green' ? 'Little change: keep training.' : 'Usually months to years; some loss may not fully return.',
      tasks:
        status === 'green'
          ? []
          : [
              { id: 'bone_impact', title: 'Gentle impact loading', detail: 'Heel drops and step-ups to load the hips and spine.', minutes: 10, from: 10, to: RECOVERY_DAYS - 1, forFinding: 'bone' },
              { id: 'bone_diet', title: 'Calcium + vitamin D', detail: 'Meals and supplements as the nutritionist set them.', minutes: 0, from: 0, to: RECOVERY_DAYS - 1, forFinding: 'bone' },
              { id: 'bone_fall', title: 'Fall-safe home', detail: 'Night light, no loose rugs: bones are weaker for now.', minutes: 0, from: 0, to: 14, forFinding: 'bone' },
            ],
    });
  }

  const onsd = latest(readings, 'onsd');
  const iop = latest(readings, 'iop');
  if (onsd || iop) {
    const onsdUp = onsd ? onsd.currentValue - crew.preFlightOnsdMm : 0;
    const status: FindingStatus = onsdUp >= 0.8 ? 'red' : onsdUp >= 0.3 ? 'yellow' : 'green';
    findings.push({
      id: 'eyes',
      title: 'Eyes (SANS)',
      status,
      summary: onsd ? `Optic nerve sheath ${fmt(onsd.currentValue, 2)} mm (pre-flight ${fmt(crew.preFlightOnsdMm, 2)} mm).` : `Eye pressure ${fmt(iop!.currentValue)} mmHg.`,
      outlook: status === 'green' ? 'No sign of change.' : 'Often improves over months; some changes can last. Needs eye follow-up.',
      tasks:
        status === 'green'
          ? []
          : [
              { id: 'eye_exam', title: 'Eye exam booked', detail: 'Vision test, retina imaging (OCT) and fundus photo.', minutes: 0, from: 3, to: 3, forFinding: 'eyes' },
              { id: 'eye_watch', title: 'Report vision changes', detail: 'Blurring, a new need for glasses or headaches: tell the flight surgeon.', minutes: 0, from: 0, to: RECOVERY_DAYS - 1, forFinding: 'eyes' },
            ],
    });
  }

  const hr = latest(readings, 'resting_hr');
  const sbp = latest(readings, 'systolic_bp');
  if (hr || sbp) {
    const hrUp = hr ? hr.currentValue - crew.restingHrBaselineBpm : 0;
    const status: FindingStatus = hrUp >= 15 ? 'red' : hrUp >= 7 ? 'yellow' : 'green';
    findings.push({
      id: 'heart',
      title: 'Heart & blood pressure',
      status: status === 'green' ? 'yellow' : status, // after flight, standing up is always a risk at first
      summary: `${hr ? `Resting HR ${fmt(hr.currentValue, 0)} bpm (pre-flight ${crew.restingHrBaselineBpm})` : ''}${hr && sbp ? ', ' : ''}${sbp ? `systolic ${fmt(sbp.currentValue, 0)} mmHg` : ''}.`,
      outlook: 'Standing tolerance usually returns in days to a couple of weeks; endurance over weeks.',
      tasks: [
        { id: 'stand_test', title: 'Stand test', detail: 'Lie 5 min, stand 3 min; log heart rate and dizziness.', minutes: 10, from: 0, to: 7, forFinding: 'heart' },
        ...(status === 'red'
          ? [{ id: 'hr_cap', title: 'Heart-rate cap', detail: `Keep workouts under ${crew.restingHrBaselineBpm + 70} bpm until cleared.`, minutes: 0, from: p1End + 1, to: 21, forFinding: 'heart' }]
          : []),
      ],
    });
  }

  const rad = latest(readings, 'rad_dose');
  if (rad) {
    const total = rad.history.reduce((a, p) => a + p.value, 0);
    const status: FindingStatus = total >= 100 ? 'yellow' : 'green';
    findings.push({
      id: 'radiation',
      title: 'Radiation',
      status,
      summary: `Logged mission dose ≈ ${fmt(total, 0)} ${rad.unit.replace('/24h', '').replace('/day', '')} (sum of daily readings).`,
      outlook: 'No recovery time as such: it adds to your lifetime dose, followed up over years.',
      tasks: [{ id: 'rad_blood', title: 'Blood count', detail: 'Full blood count and the long-term radiation follow-up file.', minutes: 0, from: 7, to: 7, forFinding: 'radiation' }],
    });
  }

  const wbc = latest(readings, 'wbc_lymph');
  if (wbc) {
    const status: FindingStatus = wbc.currentValue < 1.0 ? 'red' : wbc.currentValue < 1.5 ? 'yellow' : 'green';
    findings.push({
      id: 'immune',
      title: 'Immune system',
      status,
      summary: `Lymphocytes ${fmt(wbc.currentValue)} ${wbc.unit}.`,
      outlook: status === 'green' ? 'Normal.' : 'Usually back to normal within weeks.',
      tasks:
        status === 'green'
          ? []
          : [{ id: 'immune_care', title: 'Avoid crowds and sick contacts', detail: 'Wash hands often; report fever (38.5 °C or more) at once.', minutes: 0, from: 0, to: 14, forFinding: 'immune' }],
    });
  }

  const mood = latest(readings, 'mood_index');
  const sleep = latest(readings, 'sleep_eff') ?? latest(readings, 'daily_sleep_hours');
  if (mood || sleep) {
    const low = (mood && mood.currentValue <= 2) || (sleep && sleep.metricId === 'sleep_eff' && sleep.currentValue < 80);
    findings.push({
      id: 'sleep_mind',
      title: 'Sleep & mind',
      status: low ? 'yellow' : 'green',
      summary: `${mood ? `Mood ${fmt(mood.currentValue, 0)}/5` : ''}${mood && sleep ? ', ' : ''}${sleep ? `${sleep.label} ${fmt(sleep.currentValue)} ${sleep.unit}` : ''}.`,
      outlook: 'Body clock settles in about a week; readjusting to family and work takes longer.',
      tasks: [
        { id: 'sleep_light', title: 'Morning daylight, fixed wake time', detail: 'Bright light after waking, screens off an hour before bed.', minutes: 15, from: 0, to: 14, forFinding: 'sleep_mind' },
        { id: 'debrief', title: 'Talk with the psychologist', detail: 'Return-to-Earth debrief; bring your family if you like.', minutes: 45, from: 5, to: 5, forFinding: 'sleep_mind' },
        { id: 'family', title: 'Family time', detail: 'Protected time every day; no work calls.', minutes: 60, from: 1, to: RECOVERY_DAYS - 1, forFinding: 'sleep_mind' },
      ],
    });
  }

  findings.push({
    id: 'balance',
    title: 'Balance & inner ear',
    status: 'yellow',
    summary: 'After weightlessness the inner ear needs time; turning the head can feel like spinning.',
    outlook: 'Usually days to about two weeks.',
    tasks: [{ id: 'head_turns', title: 'Slow head turns', detail: 'Seated, look left-right then up-down, 10 times; stop if sick.', minutes: 5, from: 1, to: 10, forFinding: 'balance' }],
  });

  const ared = latest(readings, 'ared_load');
  findings.push({
    id: 'muscle',
    title: 'Muscle & strength',
    status: ared && ared.currentValue < 20 ? 'yellow' : 'green',
    summary: ared ? `In-flight resistance load ${fmt(ared.currentValue, 0)} ${ared.unit} (latest).` : 'Leg and back muscles shrink in weightlessness.',
    outlook: 'Most strength returns within weeks to a few months of training.',
    tasks: [],
  });

  const order: Record<FindingStatus, number> = { red: 0, yellow: 1, green: 2 };
  findings.sort((a, b) => order[a.status] - order[b.status]);

  const checkpoints: Checkpoint[] = [
    { day: 0, title: 'Landing day', tests: ['Stand test', 'Walk and balance check', 'Blood and urine'] },
    { day: 3, title: 'R+3', tests: ['Balance (sway)', 'Strength', findings.some((f) => f.id === 'eyes' && f.status !== 'green') ? 'Eye exam' : 'Vision check'] },
    { day: 14, title: 'R+14', tests: ['Treadmill fitness test', 'Strength', 'Balance'] },
    { day: 30, title: 'R+30', tests: ['Bone scan', 'Fitness', 'Mood & sleep review'] },
    { day: RECOVERY_DAYS - 1, title: 'R+44 · end of plan', tests: ['All tests vs pre-flight', 'Return-to-duty review'] },
  ];

  return { crewId: crew.id, missionDays, phases, findings, baseTasks, checkpoints };
}

export function phaseOf(plan: RecoveryPlan, day: number): RecoveryPhase {
  return plan.phases.find((p) => day >= p.from && day <= p.to) ?? plan.phases[plan.phases.length - 1];
}

/** Today's checklist: the base programme plus the tasks the findings added. */
export function tasksForDay(plan: RecoveryPlan, day: number): RecoveryTask[] {
  const all = [...plan.baseTasks, ...plan.findings.flatMap((f) => f.tasks)];
  return all.filter((t) => day >= t.from && day <= t.to);
}

export const minutesForDay = (plan: RecoveryPlan, day: number) => tasksForDay(plan, day).reduce((a, t) => a + t.minutes, 0);

/** "Welcome home" line ARGUS says when the location changes to Earth after the mission. */
export function welcomeSpeech(callsign: string, plan: RecoveryPlan): string {
  const top = plan.findings.filter((f) => f.status !== 'green').map((f) => f.title.toLowerCase().replace(' (sans)', '').replace('&', 'and'));
  const focus = top.length ? ` Your plan focuses on ${top.slice(0, 3).join(', ')}.` : '';
  return `Welcome home, ${callsign}. I prepared your ${RECOVERY_DAYS}-day recovery plan from your mission data.${focus} Today: walk with a spotter and stand up slowly.`;
}

/** Whole days between two local day keys (YYYY-MM-DD). */
export function daysBetween(fromKey: string, toKey: string): number {
  const d = (k: string) => {
    const [y, m, dd] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, dd) / 86_400_000;
  };
  return Math.round(d(toKey) - d(fromKey));
}
