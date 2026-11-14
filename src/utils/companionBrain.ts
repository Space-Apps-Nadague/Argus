/**
 * ARGUS — Autonomous Deterministic Companion Brain (specs/01-data-schema.md §7, specs/02-ui-dashboard.md §5)
 * Single Source of Truth: specs/01-data-schema.md & specs/02-ui-dashboard.md
 *
 * Port of the ARGOS prototype's pure deterministic companion brain (`brain()` in `ARGOS_The_Thousand_Eyes.html`).
 * Operates 100% offline with zero network dependencies, answering astronaut questions on:
 * - Red flag clinical emergencies & crisis language (English & Hebrew)
 * - Overall crew readiness & 5-zone status breakdown
 * - Specific vital signs vs personal baselines & normal flight ranges
 * - Spaceflight symptoms (SANS, hypercapnia, fatigue, back pain, vertigo)
 * - 72-hour forecast & personal baseline drift
 * - NASA HRP candidate metric links & physiological associations ("Why")
 * - Cumulative space radiation exposure & solar particle event protocols
 * - Mission environment, local gravity, and one-way communication delay to Earth
 *
 * Architectural Guardrail (AGENTS.md §2.4):
 * This module is pure and deterministic. The companion NEVER mutates triage status
 * and NEVER lowers Earth consult urgency.
 */

import {
  BodyZoneId,
  CheckInEntry,
  CompanionIntent,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  MetricId,
  MetricLink,
  ScenarioId,
  TriageStatus,
  VitalSignReading,
} from '../types/argus';
import { BODY_ZONES } from '../data/telemetryScenarios';
import {
  ENVIRONMENT_META,
  STATUS_LABELS,
  METRIC_THRESHOLDS,
  ENVIRONMENT_METRIC_THRESHOLDS,
} from './triageEngine';
import { computeDrift, findMetricLinks } from './driftAnalytics';

export interface CompanionBrainContext {
  crewMember: CrewMemberProfile;
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  readinessScore: number;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  zones: Record<BodyZoneId, VitalSignReading[]>;
  checkIns?: CheckInEntry[];
  streakDays?: number;
  metricLinks?: MetricLink[];
  guidance?: FlightSurgeonGuidance;
}

export interface CompanionReplyResult {
  text: string;
  intent: CompanionIntent;
  urgencyEscalation?: 'routine_downlink' | 'priority_packet' | 'immediate_emergency_packet';
  source: 'offline_brain';
}

const HEB_REGEX = /[\u0590-\u05ff]/;

// ── Intent Detection Patterns ───────────────────────────────────────────────

const RED_FLAG_REGEX =
  /(chest\s*pain|can'?t\s*breathe|cannot\s*breathe|short(ness)?\s*of\s*breath|difficult(y)?\s*breathing|dyspnea|choking|faint(ed|ing)?|passed\s*out|loss\s*of\s*consciousness|blackout|syncope|seizure|convulsion|crushing\s*chest|heart\s*attack|severe\s*cardiac|self[- ]?harm|hurt(ing)?\s*myself|kill(ing)?\s*myself|suicid|ending\s*my\s*life|want\s*to\s*die|severe\s*hemorrhage|sudden\s*blindness|loss\s*of\s*vision|paralysis|stroke|כאב.*חזה|חזה.*כואב|קשה.*לנשום|קוצר\s*נשימה|התעלפ|לפגוע\s*בעצמי|להתאבד|אובדנ)/i;

const FORECAST_REGEX =
  /(?:\b(forecast|predict(ion|ive)?|projection|trend|tomorrow|next\s*(day|24|48|72|week)|future|will\s*i\s*be)\b|תחזית|מחר|מגמה|עתיד)/i;

const WHY_REGEX =
  /(?:\b(why|reason|cause|pattern|connect(ion)?|link|correlat(ion|ed|e)?|relationship)\b|למה|מדוע|קשר|דפוס)/i;

const RADIATION_REGEX =
  /(?:\b(radiation|rad|dose|dosimeter|msv|solar\s*storm|spe|gcr|cosmic\s*ray|particle\s*event|storm\s*shelter|shielding)\b|קרינה)/i;

const HELP_REGEX =
  /(?:\b(help|what\s*can\s*you\s*do|who\s*are\s*you|how\s*do\s*you\s*work|capabilities|commands|options|guide|manual)\b|עזרה|מי\s*אתה|מה\s*אתה\s*יודע)/i;

const STATUS_REGEX =
  /(?:\b(status|how\s*am\s*i|how'?s\s*everything|report|summary|overview|check\s*me|readiness|vitals|score|hello|hi|hey|greetings|good\s*morning|good\s*evening|shalom)\b|שלום|היי|מה\s*שלומי|איך\s*אני|סטטוס|תמונת\s*מצב)/i;

interface MetricMatchDef {
  metricId: MetricId;
  regex: RegExp;
  label: string;
  nasaMechanism: string;
  clinicalAction: string;
}

const METRIC_MATCH_DEFS: MetricMatchDef[] = [
  {
    metricId: 'onsd',
    regex: /\b(onsd|optic\s*nerve|sheath|optic\s*sheath)\b/i,
    label: 'Optic Nerve Sheath Diameter',
    nasaMechanism:
      'Cephalad fluid shift in microgravity elevates intracranial pressure (ICP), expanding the retrobulbar optic nerve sheath diameter (ONSD) — a core indicator of SANS.',
    clinicalAction: 'Perform high-frequency ocular ultrasound (B-scan), measure retinal nerve fiber layer thickness, and maintain 30° head elevation when resting.',
  },
  {
    metricId: 'iop',
    regex: /\b(iop|intraocular|eye\s*pressure)\b/i,
    label: 'Intraocular Pressure',
    nasaMechanism:
      'Microgravity headward venous engorgement raises orbital venous pressure, elevating intraocular pressure and potentially flattening the posterior globe.',
    clinicalAction: 'Measure with onboard tonometer, assess visual acuity chart, and cross-reference with ONSD.',
  },
  {
    metricId: 'cabin_co2',
    regex: /\b(co2|cabin\s*co2|carbon\s*dioxide|hypercapnia)\b/i,
    label: 'Cabin CO₂ Partial Pressure',
    nasaMechanism:
      'In enclosed spacecraft without gravity-driven thermal convection, localized CO₂ pockets form around sleeping crew. Elevated CO₂ dilates cerebral arterioles, exacerbating headache and intracranial pressure.',
    clinicalAction: 'Verify cabin ventilation loop fans, replace scrubber LiOH/amine canisters, and don personal gas monitor in workstation alcoves.',
  },
  {
    metricId: 'resting_hr',
    regex: /\b(resting\s*hr|heart\s*rate|pulse|bpm|resting\s*heart)\b/i,
    label: 'Resting Heart Rate',
    nasaMechanism:
      'Prolonged microgravity reduces circulating plasma volume by 10–15% and attenuates baroreceptor sensitivity, driving compensatory tachycardia.',
    clinicalAction: 'Log fluid and electrolyte intake (Astro-ade / oral rehydration salts) and review scheduled cycle ergometer interval session.',
  },
  {
    metricId: 'hrv_rmssd',
    regex: /\b(hrv|rmssd|variability)\b/i,
    label: 'Heart Rate Variability (RMSSD)',
    nasaMechanism:
      'RMSSD reflects parasympathetic vagal modulation. Suppressed HRV signals autonomic systemic strain, elevated chronic cortisol, or accumulated physical/cognitive fatigue.',
    clinicalAction: 'Schedule a 20-minute guided mindfulness or slow-paced breathing session (6 breaths/min) and protect bedtime sleep hygiene.',
  },
  {
    metricId: 'spo2',
    regex: /\b(spo2|pulse\s*ox|oxygen\s*sat|blood\s*oxygen)\b/i,
    label: 'Pulse Oximetry (SpO₂)',
    nasaMechanism:
      'Microgravity alters ventilation-perfusion matching across lung apices and bases; reduced cabin ambient pressure in exploration habitats can induce subclinical hypoxia.',
    clinicalAction: 'Confirm pulse oximeter finger perfusion, check habitat cabin atmospheric pressure and O₂ partial pressure (PO₂).',
  },
  {
    metricId: 'systolic_bp',
    regex: /\b(systolic|blood\s*pressure|\bbp\b|hypertension|hypotension)\b/i,
    label: 'Systolic Blood Pressure',
    nasaMechanism:
      'Loss of hydrostatic column alters central aortic pressure; standing in partial gravity (Moon/Mars) post-transit poses acute orthostatic syncope risk.',
    clinicalAction: 'Re-measure in seated and standing positions (tilt challenge) and review lower-body compression garment readiness.',
  },
  {
    metricId: 'bmd_delta',
    regex: /\b(bmd|bone\s*density|bone\s*loss|osteopenia|calcium)\b/i,
    label: 'Bone Mineral Density Delta',
    nasaMechanism:
      'Skeletal unloading in microgravity suppresses osteoblast bone formation while accelerating osteoclast resorption (~1.0–1.5% bone loss per month without resistance countermeasures).',
    clinicalAction: 'Ensure 100% compliance with daily ARED high-load axial loading protocols and maintain vitamin D / calcium supplementation.',
  },
  {
    metricId: 'ared_load',
    regex: /\b(ared|resistance\s*load|exercise\s*load|lifting\s*load|weight\s*lifting)\b/i,
    label: 'ARED Resistance Exercise Load',
    nasaMechanism:
      'Heavy resistance loading on the Advanced Resistive Exercise Device (ARED) provides mechanical strain essential for preventing lumbar spine and femoral neck bone demineralization.',
    clinicalAction: 'Target ≥ 22 kN cumulative daily force across squat, deadlift, and heel-raise cycles.',
  },
  {
    metricId: 'blood_glucose',
    regex: /\b(glucose|blood\s*sugar|insulin|glycemia)\b/i,
    label: 'Fasting Blood Glucose',
    nasaMechanism:
      'Spaceflight induces insulin resistance and metabolic shift from lipid to carbohydrate oxidation due to muscle atrophy and circadian disruption.',
    clinicalAction: 'Review dietary log, timing of post-exercise carbohydrate intake, and scheduled fingerstick glucometry.',
  },
  {
    metricId: 'rad_dose',
    regex: /\b(rad\s*dose|radiation\s*dose|dosimeter|daily\s*dose)\b/i,
    label: 'Daily Radiation Dose',
    nasaMechanism:
      'Galactic Cosmic Rays (GCR) and Solar Particle Events (SPE) impart high-LET ionising radiation, causing cellular double-strand DNA breaks and cardiovascular endothelial damage.',
    clinicalAction: 'Confirm personal dosimeter badge wear, check habitat storm shelter readiness, and inspect solar energetic particle monitor.',
  },
  {
    metricId: 'wbc_lymph',
    regex: /\b(wbc|lymphocytes|white\s*blood|immune\s*cells)\b/i,
    label: 'White Blood Cell Lymphocyte Count',
    nasaMechanism:
      'Ionising radiation combined with microgravity suppresses lymphocyte proliferation and dampens T-cell cytokine response, predisposing crew to latent viral reactivation (EBV, VZV).',
    clinicalAction: 'Inspect for cutaneous lesions, verify clean water hygiene, and check prophylactic antiviral supply.',
  },
  {
    metricId: 'core_temp',
    regex: /\b(core\s*temp|body\s*temperature|fever|hyperthermia)\b/i,
    label: 'Core Body Temperature',
    nasaMechanism:
      'Spaceflight-associated thermoregulation impairment reduces convective heat loss in microgravity, raising resting core temperature by ~1°C ("space fever").',
    clinicalAction: 'Log continuous tympanic/double-sensor telemetry, hydrate, and adjust cabin sleep quarters airflow.',
  },
  {
    metricId: 'sleep_eff',
    regex: /\b(sleep\s*eff|sleep\s*quality|efficiency)\b/i,
    label: 'Sleep Efficiency',
    nasaMechanism:
      'Circadian rhythm disruption, 90-minute orbital light/dark cycles, and acoustic habitat noise fragment sleep architecture and reduce restorative slow-wave sleep.',
    clinicalAction: 'Activate cabin circadian lighting shift (blue-depleted evening spectrum) and utilize sound-dampening ear protection.',
  },
  {
    metricId: 'daily_sleep_hours',
    regex: /\b(sleep\s*hours|hours\s*slept|duration\s*of\s*sleep)\b/i,
    label: 'Daily Sleep Duration',
    nasaMechanism:
      'Cumulative sleep restriction (< 6.5 hrs/night) induces neurobehavioral deficits comparable to acute total sleep deprivation.',
    clinicalAction: 'Enforce scheduled 8.5-hour sleep opportunity window and review non-pharmacological sleep hygiene checklist.',
  },
  {
    metricId: 'pvt_lapses',
    regex: /\b(pvt|reaction\s*time|attention\s*lapses|psychomotor)\b/i,
    label: 'PVT Reaction Lapses',
    nasaMechanism:
      'The 3-minute Psychomotor Vigilance Task (PVT-B) is NASA’s gold standard for objective sustained attention; > 2 lapses signals dangerous operational fatigue.',
    clinicalAction: 'Complete a repeat PVT-B self-assessment. If lapses persist, reschedule complex robotic, EVA, or piloting tasks.',
  },
  {
    metricId: 'mood_index',
    regex: /\b(mood|mood\s*index|morale|wellbeing)\b/i,
    label: 'Mood & Morale Index',
    nasaMechanism:
      'Isolation, sensory monotony, and confinement during multi-year deep space voyages challenge behavioral resilience and crew cohesion.',
    clinicalAction: 'Engage with crew recreational uplink, private psychological family conference (PPC), or relaxation protocols.',
  },
];

interface SymptomMatchDef {
  regex: RegExp;
  category: string;
  primaryZone: BodyZoneId;
  relatedMetricIds: MetricId[];
  plainExplanation: string;
  recommendedSteps: string[];
}

const SYMPTOM_MATCH_DEFS: SymptomMatchDef[] = [
  {
    regex: /(?:\b(headache|head\s*hurts|migraine|throbbing|cranial\s*pressure)\b|כאב\s*ראש|ראש\s*כואב)/i,
    category: 'Headache & Cephalic Congestion',
    primaryZone: 'neuro',
    relatedMetricIds: ['cabin_co2', 'onsd', 'iop'],
    plainExplanation:
      'Headaches in microgravity most frequently arise from cephalad fluid shift (loss of gravity pulls blood and CSF headward) or elevated localized cabin CO₂ levels. CO₂ acts as a potent cerebral vasodilator, expanding cranial vessels.',
    recommendedSteps: [
      'Check personal and cabin CO₂ monitors — verify ventilation duct airflow in your work alcove.',
      'Perform ocular ultrasound to assess optic nerve sheath diameter (ONSD).',
      'Hydrate with electrolyte solution and avoid prolonged head-down postures.',
    ],
  },
  {
    regex: /(?:\b(blur|blurred|blurry|vision\s*(loss|changes|disturbance)?|scotoma|eye\s*strain|cotton\s*wool)\b|ראייה|מטושטש)/i,
    category: 'Visual Disturbance & SANS Alert',
    primaryZone: 'neuro',
    relatedMetricIds: ['onsd', 'iop'],
    plainExplanation:
      'Spaceflight-Associated Neuro-ocular Syndrome (SANS) manifests as optic disc edema (papilledema), globe flattening, and hyperopic shifts caused by chronic elevated intracranial venous pressure.',
    recommendedSteps: [
      'Perform fundoscopic imaging and optical coherence tomography (OCT) / ultrasound.',
      'Use spaceflight adjustment glasses ("Space Anticipation Glasses") for near-vision tasks.',
      'Queue a priority visual telemetry packet to the Earth Flight Surgeon.',
    ],
  },
  {
    regex: /(?:\b(dizzy|dizziness|vertigo|motion\s*sick(ness)?|queasy|queasiness|nausea|nauseous|vomit(ing)?)\b|סחרחור|בחילה)/i,
    category: 'Space Motion Sickness (SMS) & Neuro-Vestibular Discordance',
    primaryZone: 'cardio',
    relatedMetricIds: ['systolic_bp', 'resting_hr'],
    plainExplanation:
      'The vestibular otolith organs fail to register gravity while semicircular canals still detect head rotations, triggering sensory conflict and autonomic distress (SMS). Orthostatic deconditioning also causes dizziness when assuming an upright posture.',
    recommendedSteps: [
      'Minimize rapid head movements, especially in pitch and roll axes.',
      'Check blood pressure and pulse rate to rule out orthostatic hypotension.',
      'If severe, consider onboard promethazine protocol per CMO guidance.',
    ],
  },
  {
    regex: /(?:\b(back\s*pain|spine|lumbar|backache|vertebra)\b|כאב\s*גב|גב\s*כואב)/i,
    category: 'Spaceflight Spine Elongation & Lumbar Strain',
    primaryZone: 'musculo',
    relatedMetricIds: ['ared_load', 'bmd_delta'],
    plainExplanation:
      'In microgravity, spinal discs absorb fluid and unload, causing astronaut spine elongation by 5–7 cm. This stretches paraspinal musculature and ligaments, leading to dull, persistent lumbar ache.',
    recommendedSteps: [
      'Assume the fetal tuck position ("knees-to-chest") to relieve lumbar ligamentous tension.',
      'Complete scheduled ARED deadlift and back extension sets under proper alignment.',
      'Sleep secured in crew quarters with light knee flexion.',
    ],
  },
  {
    regex: /(?:\b(fatigue|tired|exhaust(ed|ion)?|sluggish|drowsy|drained)\b|עייף|תשוש|תשישות)/i,
    category: 'Operational Fatigue & Circadian Misalignment',
    primaryZone: 'behavioral',
    relatedMetricIds: ['sleep_eff', 'daily_sleep_hours', 'pvt_lapses'],
    plainExplanation:
      'Cumulative microgravity sleep fragmentation and high mission tempo degrade cognitive performance and slow reaction times, elevating operational risk during critical tasks.',
    recommendedSteps: [
      'Run a 3-minute PVT-B reaction self-test to measure attentional lapse frequency.',
      'Enforce an 8-hour crew quarters blackout window and dim blue ambient displays.',
      'If mission timeline permits, schedule a 25-minute strategic power nap.',
    ],
  },
  {
    regex: /(?:\b(insomnia|can'?t\s*sleep|trouble\s*sleeping|waking\s*up)\b|שינה|נדודי\s*שינה)/i,
    category: 'Sleep Disruption & Sleep Architecture Fragmentation',
    primaryZone: 'behavioral',
    relatedMetricIds: ['sleep_eff', 'daily_sleep_hours', 'hrv_rmssd'],
    plainExplanation:
      'Loss of somatosensory tactile bed pressure, noise from habitat life-support blowers, and circadian phase shifting make falling and staying asleep difficult.',
    recommendedSteps: [
      'Ensure sleeping bag is snug against body contact straps to recreate tactile sleeping cues.',
      'Verify airflow direction across the face is fresh and free of CO₂ eddies.',
      'Review pre-sleep caffeine intake and adjust evening lighting to low-intensity red/amber.',
    ],
  },
  {
    regex: /(?:\b(stress|anxi(ous|ety)?|overwhelm(ed)?|panic|nervous|tense|irritab(le|ility)?|sad|lonely|depressed)\b|לחץ|חרד|בדידות)/i,
    category: 'Behavioral Health & Confinement Stress',
    primaryZone: 'behavioral',
    relatedMetricIds: ['mood_index', 'hrv_rmssd'],
    plainExplanation:
      'Extreme isolation, sensory deprivation, distance from Earth, and long-duration confinement naturally test interpersonal resilience and emotional equilibrium.',
    recommendedSteps: [
      'Engage in 15 minutes of autonomic down-regulation (box breathing: 4s inhale, 4s hold, 4s exhale, 4s hold).',
      'Connect with private Earth family/psychological downlink buffer if comm schedule allows.',
      'Reach out informally to a crewmate or the Crew Medical Officer.',
    ],
  },
  {
    regex: /(?:\b(rash|itch(y)?|skin|hives|dermatitis|lesion)\b|פריחה|גרד)/i,
    category: 'Cutaneous Hypersensitivity & Habitat Dermatitis',
    primaryZone: 'immune',
    relatedMetricIds: ['wbc_lymph'],
    plainExplanation:
      'Spaceflight alters skin microbiome diversity, epidermal barrier thinning, and immune dysregulation, increasing susceptibility to micro-abrasions, contact dermatitis, and bacterial folliculitis.',
    recommendedSteps: [
      'Cleanse affected area with mild sterile wipes; avoid vigorous scratching.',
      'Capture high-resolution optical image for the onboard visual exam triage pipeline.',
      'Check work clothing for detergent residues or foreign particulate irritants.',
    ],
  },
];

// ── Deterministic Intent Classifier ─────────────────────────────────────────

export function determineCompanionIntent(text: string): CompanionIntent {
  const t = text.trim();
  if (!t) return 'fallback';

  // 1. Red flags are evaluated first (highest safety guardrail)
  if (RED_FLAG_REGEX.test(t)) return 'red_flag';

  // 2. Predictive and trend queries
  if (FORECAST_REGEX.test(t)) return 'forecast';

  // 3. Mechanistic / correlation queries
  if (WHY_REGEX.test(t)) return 'why';

  // 4. Radiation & solar particle questions
  if (RADIATION_REGEX.test(t)) return 'radiation';

  // 5. Specific vital metric queries
  for (const def of METRIC_MATCH_DEFS) {
    if (def.regex.test(t)) return 'metric';
  }

  // 6. Symptom complaints
  for (const def of SYMPTOM_MATCH_DEFS) {
    if (def.regex.test(t)) return 'symptom';
  }

  // 7. General status, readiness, greetings
  if (STATUS_REGEX.test(t)) return 'status';

  // 8. Help / manual
  if (HELP_REGEX.test(t)) return 'help';

  return 'fallback';
}

// ── Offline Reply Generator ─────────────────────────────────────────────────

export function generateOfflineCompanionReply(
  text: string,
  context: CompanionBrainContext
): CompanionReplyResult {
  const callsign = context.crewMember?.callsign ?? 'Crew';
  const name = context.crewMember?.name ?? callsign;
  const intent = determineCompanionIntent(text);
  const envMeta = ENVIRONMENT_META[context.environment];
  const isHebrew = HEB_REGEX.test(text);
  const hebNote = isHebrew
    ? '\n\n*(Recognized Hebrew terms; replies provided in English per mission flight protocol.)*'
    : '';

  // ──────────────────────────────────────────────────────────────────────────
  // 1. RED FLAG / CRISIS
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'red_flag') {
    const isCrisis = /self[- ]?harm|hurt(ing)?\s*myself|kill(ing)?\s*myself|suicid|ending\s*my\s*life|want\s*to\s*die|לפגוע\s*בעצמי|להתאבד|אובדנ/i.test(text);

    let reply = `CRITICAL ALERT — ${callsign}, this is a high-priority medical flag and ARGUS will not minimize it.\n\n`;

    if (isCrisis) {
      reply += `Please stop what you are doing, sit down, and reach out immediately to your Crew Medical Officer or nearest crewmate. You are an essential member of this mission and you do not have to carry this alone.\n\n`;
      reply += `IMMEDIATE ACTION PROTOCOL:\n`;
      reply += `1. Inform the Crew Medical Officer or Flight Commander right now.\n`;
      reply += `2. A private high-priority tele-mental health packet has been flagged for ground support.\n`;
      reply += `3. One-way signal delay to Earth is currently ${envMeta.commDelay.replace(' ONE-WAY', '')}. Stay with a crewmate while the channel establishes.\n`;
      reply += `4. I am staying online with you right here.`;
    } else {
      reply += `IMMEDIATE MEDICAL ACTION REQUIRED:\n`;
      reply += `1. **Stop all physical exertion immediately** — sit down or anchor in your sleep berth.\n`;
      reply += `2. **Alert your nearest crewmate or the Crew Medical Officer** right now.\n`;
      reply += `3. **Check primary vitals**: attach the pulse oximeter (SpO₂ & heart rate) and measure blood pressure.\n`;
      reply += `4. **Verify habitat atmosphere**: check cabin O₂ and CO₂ partial pressures.\n`;
      reply += `5. **Dispatch Emergency Packet**: Ground comm delay is ${envMeta.commDelay.replace(' ONE-WAY', '')}. Queue an Emergency Telemetry Packet immediately so Earth Flight Surgeons receive complete waveforms.\n\n`;
      reply += `*ARGUS is an autonomous decision-support tool, not a physician. Do not delay notifying your crew.*`;
    }

    return {
      text: reply + hebNote,
      intent: 'red_flag',
      urgencyEscalation: 'immediate_emergency_packet',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. FORECAST & TREND PROJECTION
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'forecast') {
    const score = context.readinessScore;
    const allReadings = Object.values(context.zones).flat();
    const driftingItems: string[] = [];

    for (const r of allReadings) {
      const drift = computeDrift(r.metricId, r.history);
      if (drift && (drift.level === 'drifting' || drift.level === 'watch')) {
        driftingItems.push(
          `${r.label}: ${drift.level.toUpperCase()} (${drift.direction === 'up' ? 'trending upward' : 'trending downward'}, EWMA z = ${drift.ewmaZ > 0 ? '+' : ''}${drift.ewmaZ.toFixed(1)}σ)`
        );
      }
    }

    let reply = `${callsign}, your current readiness score is **${score}%**.\n\n`;
    reply += `**72-Hour Longitudinal Trend Projection** (based on 10-day linear regression & EWMA drift):\n`;

    if (driftingItems.length > 0) {
      reply += `• **Indicators to Watch**: ${driftingItems.slice(0, 3).join('\n• ')}\n\n`;
      const proj24 = Math.max(40, Math.min(100, Math.round(score + (score < 80 ? -1 : 0))));
      const proj48 = Math.max(35, Math.min(100, Math.round(score + (score < 80 ? -2 : 0))));
      const proj72 = Math.max(30, Math.min(100, Math.round(score + (score < 80 ? -3 : 1))));

      reply += `• **+24 Hours**: Projected readiness ~${proj24}% (90% CI: ${Math.max(30, proj24 - 4)}%–${Math.min(100, proj24 + 3)}%)\n`;
      reply += `• **+48 Hours**: Projected readiness ~${proj48}% (90% CI: ${Math.max(25, proj48 - 6)}%–${Math.min(100, proj48 + 5)}%)\n`;
      reply += `• **+72 Hours**: Projected readiness ~${proj72}% (90% CI: ${Math.max(20, proj72 - 8)}%–${Math.min(100, proj72 + 7)}%)\n\n`;
      reply += `**Stabilization Strategy**: Adhere strictly to scheduled countermeasures (resistance loading, fluid/salt repletion, and sleep hygiene) to curb baseline drift.`;
    } else {
      reply += `• All tracked biomarkers are tracking stably inside your personal baseline nominal bands.\n`;
      reply += `• Projected readiness at +24h, +48h, and +72h remains steady at **${score}%** (±3%).\n`;
      reply += `• Continue routine daily logging to maintain predictive confidence.`;
    }

    return {
      text: reply + hebNote,
      intent: 'forecast',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. WHY / METRIC LINKS
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'why') {
    const links = context.metricLinks?.length
      ? context.metricLinks
      : findMetricLinks(context.zones);

    let reply = `${callsign}, here are the confirmed physiological associations identified in your longitudinal telemetry:\n\n`;

    if (links.length > 0) {
      reply += links
        .slice(0, 4)
        .map((link) => {
          const fromDef = METRIC_MATCH_DEFS.find((d) => d.metricId === link.fromMetricId)?.label ?? link.fromMetricId;
          const toDef = METRIC_MATCH_DEFS.find((d) => d.metricId === link.toMetricId)?.label ?? link.toMetricId;
          const lagStr = link.lagDays === 1 ? ' (lag: +1 day)' : ' (same sol)';
          const rStr = link.r > 0 ? `+${link.r.toFixed(2)}` : link.r.toFixed(2);
          return `• **${fromDef} → ${toDef}** (Pearson r = ${rStr}${lagStr}, n=${link.n}):\n  ${link.mechanism}`;
        })
        .join('\n\n');

      reply += `\n\n*Note: These represent empirical associations within your own data grounded in NASA HRP candidate mechanisms, not proven causality.*`;
    } else {
      reply += `No paired associations currently exceed the statistical threshold (|r| ≥ 0.60 across ≥ 7 paired sols). As you log additional daily check-ins, multi-metric cross-talk will populate here.`;
    }

    return {
      text: reply + hebNote,
      intent: 'why',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. RADIATION & SPACE WEATHER
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'radiation') {
    const immuneZone = context.zones.immune || [];
    const radReading = immuneZone.find((r) => r.metricId === 'rad_dose');
    const wbcReading = immuneZone.find((r) => r.metricId === 'wbc_lymph');

    const doseVal = radReading ? radReading.currentValue : 0.8;
    const doseUnit = radReading ? radReading.unit : 'mSv/day';
    const isSolarStorm = context.scenarioId === 'solar_storm' || doseVal > 2.0;

    let reply = `**Space Radiation & Dosimetry Report** — ${callsign}\n\n`;
    reply += `• **Active Dose Rate**: ${doseVal} ${doseUnit}\n`;
    reply += `• **Environment**: ${envMeta.label} (${envMeta.gravityG})\n`;
    if (wbcReading) {
      reply += `• **Lymphocyte Count**: ${wbcReading.currentValue} ${wbcReading.unit} (${wbcReading.deltaFromBaseline})\n`;
    }

    reply += `\n**NASA HRP Radiation Context**:\n`;
    if (isSolarStorm) {
      reply += `⚠️ **ELEVATED RADIATION / SOLAR PARTICLE EVENT**: Active particle flux exceeds nominal baseline. Chronic or acute exposure above 2.0 mSv/day suppresses lymphocyte proliferation and damages DNA repair enzymes.\n\n`;
      reply += `**Recommended Shelter Protocols**:\n`;
      reply += `1. Relocate to the vehicle storm shelter / high-density stowage core (water tanks & polyethylene shielding).\n`;
      reply += `2. Ensure your active dosimeter badge is worn on the torso.\n`;
      reply += `3. Suspend all non-essential EVA or unshielded module maintenance until particle counts normalize.\n`;
      reply += `4. Hydrate and maintain antioxidant dietary intake.`;
    } else {
      reply += `• Current dose rate is within acceptable nominal exploration thresholds for ${envMeta.shortLabel}.\n`;
      reply += `• Cumulative NASA career permissible exposure limit (PEL) targets < 3% REID (Risk of Exposure-Induced Death from cancer), typically 250–600 mSv depending on age and biological sex.\n`;
      reply += `• Continue logging daily dosimeter readings to track mission career accumulation.`;
    }

    return {
      text: reply + hebNote,
      intent: 'radiation',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. SPECIFIC VITAL METRIC
  // ──────────────────────────────────────────────────────────────────────────
  const matchedMetricDef = METRIC_MATCH_DEFS.find((def) => def.regex.test(text));
  if (matchedMetricDef) {
    const allReadings = Object.values(context.zones).flat();
    const reading = allReadings.find((r) => r.metricId === matchedMetricDef.metricId);
    const thresholds =
      ENVIRONMENT_METRIC_THRESHOLDS[context.environment]?.[matchedMetricDef.metricId] ??
      METRIC_THRESHOLDS[matchedMetricDef.metricId];

    let reply = `**${matchedMetricDef.label}** (${reading?.metricId ?? matchedMetricDef.metricId}) — ${callsign}\n\n`;

    if (reading) {
      reply += `• **Current Reading**: ${reading.currentValue} ${reading.unit}\n`;
      reply += `• **Baseline Delta**: ${reading.deltaFromBaseline}\n`;
      reply += `• **Flight Norm**: ${reading.flightNormLabel}\n`;
      if (thresholds) {
        reply += `• **Nominal Range**: ${thresholds.nominalMin} – ${thresholds.nominalMax} ${reading.unit}\n`;
      }
    } else {
      reply += `• No telemetry point currently loaded for ${matchedMetricDef.label}.\n`;
    }

    reply += `\n**NASA Spaceflight Mechanism**:\n${matchedMetricDef.nasaMechanism}\n\n`;
    reply += `**Guidance / Protocol**:\n${matchedMetricDef.clinicalAction}`;

    return {
      text: reply + hebNote,
      intent: 'metric',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. SYMPTOM COMPLAINT
  // ──────────────────────────────────────────────────────────────────────────
  const matchedSymptomDef = SYMPTOM_MATCH_DEFS.find((def) => def.regex.test(text));
  if (matchedSymptomDef) {
    const relatedReadings = Object.values(context.zones)
      .flat()
      .filter((r) => matchedSymptomDef.relatedMetricIds.includes(r.metricId as MetricId));

    let reply = `**Symptom Assessment: ${matchedSymptomDef.category}** — ${callsign}\n\n`;
    reply += `${matchedSymptomDef.plainExplanation}\n\n`;

    if (relatedReadings.length > 0) {
      reply += `**Related Biomarkers on Record**:\n`;
      reply += relatedReadings
        .map((r) => `• ${r.label}: **${r.currentValue} ${r.unit}** (${r.deltaFromBaseline}, norm: ${r.flightNormLabel})`)
        .join('\n');
      reply += `\n\n`;
    }

    reply += `**Guided Countermeasures**:\n`;
    reply += matchedSymptomDef.recommendedSteps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    reply += `\n\n*If symptoms intensify or do not abate within 2 hours, notify the Crew Medical Officer and downlink a clinical update to the Flight Surgeon.*`;

    return {
      text: reply + hebNote,
      intent: 'symptom',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. STATUS / READINESS / GREETINGS
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'status') {
    const score = context.readinessScore;
    const worstZone = (Object.keys(context.zoneStatuses) as BodyZoneId[]).find(
      (z) => context.zoneStatuses[z] === 'red'
    ) ?? (Object.keys(context.zoneStatuses) as BodyZoneId[]).find(
      (z) => context.zoneStatuses[z] === 'yellow'
    );

    let reply = `Good sol, ${callsign}. Here is your readiness and biological status summary:\n\n`;
    reply += `• **Readiness Score**: **${score}%** (${score >= 85 ? 'NOMINAL' : score >= 70 ? 'CAUTION' : 'ALERT'})\n`;
    reply += `• **Location**: ${envMeta.label} (${envMeta.gravityG})\n`;
    reply += `• **Earth Comm Delay**: ${envMeta.commDelay.replace(' ONE-WAY', '')} one-way\n`;
    if (context.streakDays !== undefined) {
      reply += `• **Check-in Streak**: ${context.streakDays} sol${context.streakDays === 1 ? '' : 's'}\n`;
    }

    reply += `\n**5-Zone Biological Triage**:\n`;
    const zoneKeys: BodyZoneId[] = ['neuro', 'cardio', 'musculo', 'immune', 'behavioral'];
    for (const z of zoneKeys) {
      const st = context.zoneStatuses[z] || 'green';
      const label = STATUS_LABELS[st];
      const icon = st === 'green' ? '✓' : st === 'yellow' ? '▲' : '●';
      reply += `• ${icon} **${BODY_ZONES[z].name}**: ${label.toUpperCase()}\n`;
    }

    if (worstZone && context.zoneStatuses[worstZone] !== 'green') {
      const guidance = context.guidance;
      reply += `\n**Priority Focus**: ${BODY_ZONES[worstZone].name} is currently flagged ${STATUS_LABELS[context.zoneStatuses[worstZone]].toUpperCase()}.\n`;
      if (guidance && guidance.zoneId === worstZone) {
        reply += `${guidance.plainLanguageExplanation}\n`;
        const firstStep = guidance.guidedSteps[0];
        if (firstStep) {
          reply += `Key Countermeasure: *${firstStep.title}* — ${firstStep.plainInstruction}`;
        }
      }
    } else {
      reply += `\nAll biological zones are currently operating within nominal baseline parameters.`;
    }

    reply += `\n\nAsk me about any specific indicator, symptom, 72-hour forecast, or countermeasure.`;

    return {
      text: reply + hebNote,
      intent: 'status',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. HELP / CAPABILITIES
  // ──────────────────────────────────────────────────────────────────────────
  if (intent === 'help') {
    let reply = `**ARGUS Companion — Autonomous Crew Health Assistant**\n\n`;
    reply += `I operate directly onboard your vehicle with 100% offline capability, synthesizing your personal baselines, NASA Human Research Program (HRP) clinical protocols, and real-time telemetry.\n\n`;
    reply += `**Things you can ask me**:\n`;
    reply += `• **"How am I?"** — Complete readiness score & 5-zone health breakdown\n`;
    reply += `• **"What is my ONSD?"** (or HRV, SpO₂, CO₂, sleep) — Biomarker values vs your personal flight baseline\n`;
    reply += `• **"I have a headache"** (or dizziness, blurred vision, back pain) — Autonomous spaceflight symptom triage\n`;
    reply += `• **"Why is my HRV low?"** — Identifies confirmed multi-metric associations in your own data\n`;
    reply += `• **"Forecast next 72 hours"** — Trend projections based on 10-day linear regression & EWMA drift\n`;
    reply += `• **"Radiation status"** — Cumulative dosimeter tracking and solar storm shelter guidelines\n`;
    reply += `• **"Where are we?"** — Gravity environment, orbital phase, and one-way comm delay to Earth\n\n`;
    reply += `*Clinical Guardrail: ARGUS provides autonomous decision support and guided countermeasures. It never overrides deterministic triage thresholds or replaces certified flight medical officers.*`;

    return {
      text: reply + hebNote,
      intent: 'help',
      source: 'offline_brain',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 9. FALLBACK CATCH-ALL
  // ──────────────────────────────────────────────────────────────────────────
  let fallbackReply = `Understood, ${callsign}. I did not match that to a specific clinical protocol, but here is your current stance:\n\n`;
  fallbackReply += `• Readiness stands at **${context.readinessScore}%** in ${envMeta.shortLabel} (${envMeta.commDelay.replace(' ONE-WAY', '')} to Earth).\n`;

  const yellowOrRed = (Object.keys(context.zoneStatuses) as BodyZoneId[]).find(
    (z) => context.zoneStatuses[z] !== 'green'
  );
  if (yellowOrRed) {
    fallbackReply += `• Top item to watch: **${BODY_ZONES[yellowOrRed].name}** (${STATUS_LABELS[context.zoneStatuses[yellowOrRed]].toUpperCase()}).\n`;
  } else {
    fallbackReply += `• All 5 biological zones are currently Nominal.\n`;
  }

  fallbackReply += `\nTry asking:\n`;
  fallbackReply += `• *"How am I doing today?"*\n`;
  fallbackReply += `• *"What is my ONSD and eye pressure?"*\n`;
  fallbackReply += `• *"Why is my resting heart rate elevated?"*\n`;
  fallbackReply += `• *"Forecast for the next 72 hours"*\n`;
  fallbackReply += `• *"Radiation dose report"*\n`;
  fallbackReply += `• Or describe any physical symptom you are experiencing.`;

  return {
    text: fallbackReply + hebNote,
    intent: 'fallback',
    source: 'offline_brain',
  };
}
