/**
 * ARGUS — Deterministic Offline Crew Symptom & Clinical Q&A Keyword Fallback Engine
 * Single Source of Truth: specs/01-data-schema.md (§4) & specs/04-ai-backend.md
 *
 * Evaluates free-text crew symptoms deterministically against NASA HRP spaceflight
 * medical protocols during communication blackouts when no LLM provider is reachable.
 */

import {
  BodyZoneId,
  CountermeasureStep,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  ScenarioId,
  TriageStatus,
} from '../types/argus';

export interface SymptomMatchResult {
  category: 'red_flag' | 'sans_neuro' | 'hypercapnia' | 'cardiovascular' | 'musculoskeletal' | 'immune_radiation' | 'behavioral_sleep' | 'general_query';
  zoneId: BodyZoneId;
  triageStatus: TriageStatus;
  urgency: FlightSurgeonGuidance['earthConsultUrgency'];
  headline: string;
  hazardContextSummary: string;
  plainLanguageExplanation: string;
  guidedSteps: CountermeasureStep[];
}

const RED_FLAGS = [
  'crushing chest pain',
  'loss of vision',
  'sudden blindness',
  'cannot breathe',
  'can not breathe',
  'unconscious',
  'severe hemorrhage',
  'stroke',
  'paralysis',
  'hemorrhage',
];

const CATEGORY_KEYWORDS: Record<
  'sans_neuro' | 'hypercapnia' | 'cardiovascular' | 'musculoskeletal' | 'immune_radiation' | 'behavioral_sleep',
  string[]
> = {
  sans_neuro: [
    'headache',
    'vision',
    'blur',
    'blurred',
    'optic',
    'eye',
    'eyes',
    'sans',
    'papilledema',
    'scotoma',
    'intracranial',
    'head pressure',
    'fundoscopy',
    'sheath',
    'disc edema',
    'visual acuity',
  ],
  hypercapnia: [
    'co2',
    'carbon dioxide',
    'hypercapnia',
    'scrubber',
    'scrubbers',
    'stuffy',
    'air hunger',
    'cdra',
    'lioh',
    'suffocating',
    'drowsy',
    'ppco2',
  ],
  cardiovascular: [
    'palpitation',
    'palpitations',
    'heart',
    'chest',
    'tachycardia',
    'arrhythmia',
    'pulse',
    'racing pulse',
    'dyspnea',
    'shortness of breath',
    'breath',
    'orthostatic',
    'lightheaded',
    'blood pressure',
    'bp',
    'flutter',
  ],
  musculoskeletal: [
    'back',
    'back pain',
    'spine',
    'spinal',
    'vertebra',
    'vertebrae',
    'bone',
    'bones',
    'muscle',
    'muscles',
    'lumbar',
    'elongation',
    'lengthening',
    'stiff',
    'stiffness',
    'cramp',
    'atrophy',
    'soreness',
    'neck pain',
  ],
  immune_radiation: [
    'rash',
    'rashes',
    'itch',
    'itching',
    'skin',
    'erythema',
    'radiation',
    'solar storm',
    'storm',
    'spe',
    'dosimeter',
    'lymphocyte',
    'lymphocytes',
    'allergy',
    'allergic',
    'dermatitis',
    'burn',
  ],
  behavioral_sleep: [
    'sleep',
    'insomnia',
    'fatigue',
    'exhausted',
    'exhaustion',
    'fog',
    'brain fog',
    'lapse',
    'lapses',
    'anxiety',
    'stress',
    'mood',
    'circadian',
    'nightmare',
    'alertness',
    'vigilance',
    'tired',
  ],
};

/**
 * Deterministically analyzes free-text symptoms or clinical questions.
 * Returns null if input is empty or whitespace.
 */
export function matchOfflineSymptomGuidance(params: {
  symptoms: string;
  scenarioId?: ScenarioId;
  fallbackZoneId?: BodyZoneId;
  environment?: GravityEnvironment;
  crewMember?: CrewMemberProfile;
}): FlightSurgeonGuidance | null {
  const { symptoms, scenarioId = 'nominal', fallbackZoneId = 'neuro', environment = '0g_transit', crewMember } = params;
  const raw = symptoms.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();

  // 1. Red Flag Check
  for (const rf of RED_FLAGS) {
    if (lower.includes(rf)) {
      return {
        zoneId: lower.includes('chest') || lower.includes('breathe') ? 'cardio' : 'neuro',
        environment,
        scenarioId,
        triageStatus: 'red',
        headline: `CRITICAL MEDICAL EMERGENCY: Autonomous Red-Flag Protocol (${rf.toUpperCase()})`,
        hazardContextSummary: `Spaceflight comm blackout (14m 22s one-way). Severe acute symptom "${rf}" detected during autonomous clinical monitoring.`,
        plainLanguageExplanation: `You have reported critical red-flag symptoms ("${raw}"). Immediate crew notification, life-support stabilization, and emergency ground telemetry queuing are mandatory.`,
        earthConsultUrgency: 'immediate_emergency_packet',
        guidedSteps: [
          {
            id: 'red-flag-1',
            stepNumber: 1,
            title: 'Activate Habitat Medical Alert & Notify Crew Commander',
            plainInstruction:
              'Sound the onboard medical advisory alert. Have a crewmate assist with vital sign monitoring and emergency kit deployment.',
            hardwareRequired: 'Crew Medical Kit A / Habitat Comms',
            estimatedMinutes: 2,
          },
          {
            id: 'red-flag-2',
            stepNumber: 2,
            title: 'Don Emergency O₂ Mask & Stabilize Crew Member in Restraint',
            plainInstruction:
              'Secure crew member to medical restraint couch and initiate 100% supplemental oxygen at 6 L/min.',
            hardwareRequired: 'Portable O₂ Mask + Medical Restraint System',
            estimatedMinutes: 5,
          },
          {
            id: 'red-flag-3',
            stepNumber: 3,
            title: 'Queue Emergency Telemetry & Voice Packet for Earth Flight Surgeon',
            plainInstruction:
              'Transmit immediate emergency packet containing bio-twin readings, symptom notes, and current vital sign waveforms.',
            hardwareRequired: 'ARGUS Comms Buffer (Immediate Emergency)',
            estimatedMinutes: 3,
          },
        ],
        source: 'offline_verified_cache',
      };
    }
  }

  // 2. Score Categories
  const scores: Record<keyof typeof CATEGORY_KEYWORDS, number> = {
    sans_neuro: 0,
    hypercapnia: 0,
    cardiovascular: 0,
    musculoskeletal: 0,
    immune_radiation: 0,
    behavioral_sleep: 0,
  };

  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS) as [keyof typeof CATEGORY_KEYWORDS, string[]][]) {
    for (const kw of kws) {
      if (lower.includes(kw)) {
        scores[cat] += kw.length > 5 ? 2 : 1;
      }
    }
  }

  const sortedCategories = (Object.keys(scores) as (keyof typeof CATEGORY_KEYWORDS)[]).sort(
    (a, b) => scores[b] - scores[a]
  );
  const topCategory = sortedCategories[0];
  const topScore = scores[topCategory];

  // 3. Matched Categories
  if (topScore > 0) {
    if (topCategory === 'hypercapnia') {
      return {
        zoneId: 'neuro',
        environment,
        scenarioId,
        triageStatus: 'red',
        headline: `Autonomous Triage: Hypercapnia & Cabin Air Quality Alert (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'ECLSS scrubber degradation or localized CO₂ pocketing drives elevated cabin ppCO₂, precipitating cerebral vasodilation, headache, and compensatory tachycardia.',
        plainLanguageExplanation: `Your reported symptoms indicate excess carbon dioxide exposure ("${raw}"). Reduce physical exertion immediately, switch cabin scrubbers, and breathe supplemental O₂.`,
        earthConsultUrgency: 'immediate_emergency_packet',
        guidedSteps: [
          {
            id: 'hyp-1',
            stepNumber: 1,
            title: 'Switch CDRA Desiccant/Adsorbent Bed & Inspect Return Vents',
            plainInstruction:
              'Transfer ECLSS Carbon Dioxide Removal Assembly to secondary channel and verify emergency LiOH canisters are unblocked in the airflow duct.',
            hardwareRequired: 'ECLSS Panel + 2x Emergency LiOH Canisters',
            estimatedMinutes: 12,
          },
          {
            id: 'hyp-2',
            stepNumber: 2,
            title: 'Don Portable O₂ Mask for 20 Minutes',
            plainInstruction:
              'Breathe dry-loop 100% oxygen at 4 L/min to accelerate arterial CO₂ washout and relieve hypercapnic cephalalgia.',
            hardwareRequired: 'Portable Breathing Apparatus (O₂ Mask)',
            estimatedMinutes: 20,
          },
          {
            id: 'hyp-3',
            stepNumber: 3,
            title: 'Halt Heavy Resistive Workouts (ARED) & Re-check ppCO₂',
            plainInstruction:
              'Suspend heavy metabolic loading until cabin inspired CO₂ drops below 3.0 mmHg.',
            hardwareRequired: 'Habitat Environmental Display',
            estimatedMinutes: 5,
          },
        ],
        source: 'offline_verified_cache',
      };
    }

    if (topCategory === 'sans_neuro') {
      return {
        zoneId: 'neuro',
        environment,
        scenarioId,
        triageStatus: 'yellow',
        headline: `Autonomous Triage: Neuro-Ocular & SANS Assessment (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'Cephalad fluid redistribution in 0g transit induces intracranial venous hypertension, optic nerve sheath distension, and hyperopic refractive shift.',
        plainLanguageExplanation: `Your reported neuro-ocular symptoms ("${raw}") suggest cranial venous pooling. Perform an ultrasound/fundoscopy self-exam and lower body negative pressure to redistribute fluid.`,
        earthConsultUrgency: 'priority_packet',
        guidedSteps: [
          {
            id: 'sans-sym-1',
            stepNumber: 1,
            title: 'Perform Bilateral Optic Nerve Ultrasound (ONSD)',
            plainInstruction:
              'Apply sterile acoustic gel to closed eyelids and measure optic nerve sheath diameter 3 mm posterior to the globe.',
            hardwareRequired: 'Spaceflight Handheld Ultrasound (Butterfly iQ+)',
            estimatedMinutes: 8,
          },
          {
            id: 'sans-sym-2',
            stepNumber: 2,
            title: 'Initiate 45-Minute Chibis LBNP Countermeasure Session',
            plainInstruction:
              'Don the Lower Body Negative Pressure garment at -25 mmHg to draw approximately 800–1000 mL of fluid toward lower limbs.',
            hardwareRequired: 'LBNP Chibis Suit',
            estimatedMinutes: 45,
          },
          {
            id: 'sans-sym-3',
            stepNumber: 3,
            title: 'Digital Amsler Grid & Visual Acuity Verification',
            plainInstruction:
              'Test each eye separately on the crew tablet at 40 cm to screen for paracentral scotomas or hyperopic drift.',
            hardwareRequired: 'ARGUS Crew Tablet (Vision Module)',
            estimatedMinutes: 5,
          },
        ],
        source: 'offline_verified_cache',
      };
    }

    if (topCategory === 'cardiovascular') {
      return {
        zoneId: 'cardio',
        environment,
        scenarioId,
        triageStatus: 'yellow',
        headline: `Autonomous Triage: Cardiovascular & Autonomic Symptoms (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'Central hypovolemia from microgravity fluid shifts combined with autonomic baroreflex resetting alters resting heart rate variability and orthostatic tolerance.',
        plainLanguageExplanation: `Your reported symptoms ("${raw}") point to cardiovascular or autonomic fluctuations. Ingest an electrolyte fluid bolus and record continuous ECG telemetry.`,
        earthConsultUrgency: 'priority_packet',
        guidedSteps: [
          {
            id: 'cardio-sym-1',
            stepNumber: 1,
            title: 'Capture Lead II ECG & Continuous SpO₂ Rhythm Strip',
            plainInstruction:
              'Fasten the Bio-Harness chest strap and confirm 5-minute artifact-free recording of heart rate variability and ST segment stability.',
            hardwareRequired: 'Crew Bio-Harness + Pulse Oximeter',
            estimatedMinutes: 6,
          },
          {
            id: 'cardio-sym-2',
            stepNumber: 2,
            title: 'Isotonic Electrolyte Hydration Bolus (450 mL)',
            plainInstruction:
              'Drink 450 mL of chilled isotonic electrolyte fluid to restore central circulating plasma volume.',
            hardwareRequired: 'Galley Hydration Dispenser',
            estimatedMinutes: 5,
          },
          {
            id: 'cardio-sym-3',
            stepNumber: 3,
            title: 'Aerobic CEVIS Ergometer Active Recovery Interval',
            plainInstruction:
              'Complete 15 minutes of low-resistance cycle ergometry at 60–65% HRmax to stimulate venous return without exhaustion.',
            hardwareRequired: 'CEVIS Cycle Ergometer',
            estimatedMinutes: 15,
          },
        ],
        source: 'offline_verified_cache',
      };
    }

    if (topCategory === 'musculoskeletal') {
      return {
        zoneId: 'musculo',
        environment,
        scenarioId,
        triageStatus: 'yellow',
        headline: `Autonomous Triage: Musculoskeletal & Spinal Protocol (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'Unloading of axial spinal columns in 0g causes intervertebral disc hyper-hydration, spinal elongation (up to 5–7 cm), and paravertebral muscular guarding.',
        plainLanguageExplanation: `Your symptoms ("${raw}") are characteristic of microgravity spinal lengthening and postural muscle unloading. Apply compressive axial loading and spinal flexion exercises.`,
        earthConsultUrgency: 'priority_packet',
        guidedSteps: [
          {
            id: 'musc-sym-1',
            stepNumber: 1,
            title: 'ARED Axial Compression Squat Protocol',
            plainInstruction:
              'Perform 3 sets of 10 controlled back squats on ARED at moderate resistance to restore axial compressive force on lumbar vertebrae.',
            hardwareRequired: 'ARED Exercise Device',
            estimatedMinutes: 25,
          },
          {
            id: 'musc-sym-2',
            stepNumber: 2,
            title: 'Fetal Tuck & Paraspinal Myofascial Mobilization',
            plainInstruction:
              'Use bungee restraint to pull knees to chest in 0g for 3 minutes to decompress hyper-extended paraspinal musculature.',
            hardwareRequired: 'Crew Restraint Strap',
            estimatedMinutes: 5,
          },
          {
            id: 'musc-sym-3',
            stepNumber: 3,
            title: 'Nutritional Calcium & Vitamin D3 Intake Audit',
            plainInstruction:
              'Verify daily intake of 2000 IU Vitamin D3 and ensure oral hydration is adequate to prevent hypercalciuric renal calculi.',
            hardwareRequired: 'Nutritional Countermeasure Pack',
            estimatedMinutes: 3,
          },
        ],
        source: 'offline_verified_cache',
      };
    }

    if (topCategory === 'immune_radiation') {
      const isRadiationRisk =
        lower.includes('radiation') ||
        lower.includes('spe') ||
        lower.includes('storm') ||
        lower.includes('dosimeter') ||
        lower.includes('proton');
      return {
        zoneId: 'immune',
        environment,
        scenarioId,
        triageStatus: isRadiationRisk ? 'red' : 'yellow',
        headline: `Autonomous Triage: Immune & Radiation Dosimetry Protocol (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'Deep-space ionizing radiation and enclosed cabin biome perturbations heighten dermal vulnerability, allergic hyper-reactivity, and lymphocyte suppression.',
        plainLanguageExplanation: `Your symptoms ("${raw}") relate to immune, dermal barrier, or radiation exposure. Verify dosimeter levels, inspect dermal contact points, and upload a skin capture.`,
        earthConsultUrgency: isRadiationRisk ? 'immediate_emergency_packet' : 'priority_packet',
        guidedSteps: [
          {
            id: 'imm-sym-1',
            stepNumber: 1,
            title: 'Inspect Dermal Lesion & Capture Macro Image',
            plainInstruction:
              'Examine affected skin area under white LED lighting, photograph lesion in Visual Self-Exam below, and apply topical barrier cream if indicated.',
            hardwareRequired: 'Crew Tablet Camera / Dermascope',
            estimatedMinutes: 5,
          },
          {
            id: 'imm-sym-2',
            stepNumber: 2,
            title: 'Check Active Crew Personal Dosimeter (CPD) Reading',
            plainInstruction:
              'Verify current 24-hour cumulative dose rate (mSv/d) and confirm shielding integrity around sleep quarters.',
            hardwareRequired: 'Active CPD Dosimeter',
            estimatedMinutes: 3,
          },
          {
            id: 'imm-sym-3',
            stepNumber: 3,
            title: 'Ingest Oral Antioxidant & Antihistamine Countermeasure',
            plainInstruction:
              'Take scheduled oral antioxidant countermeasure pack (N-acetylcysteine / Vitamin C) from Medical Kit B.',
            hardwareRequired: 'Crew Medical Kit B',
            estimatedMinutes: 3,
          },
        ],
        source: 'offline_verified_cache',
      };
    }

    if (topCategory === 'behavioral_sleep') {
      return {
        zoneId: 'behavioral',
        environment,
        scenarioId,
        triageStatus: 'yellow',
        headline: `Autonomous Triage: Circadian Alignment & Vigilance Protocol (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
        hazardContextSummary:
          'Disrupted 90-minute orbital light cycles and confined-habitat stressors degrade slow-wave sleep architecture, elevating cognitive lapses and fatigue.',
        plainLanguageExplanation: `Your reported sleep and cognitive symptoms ("${raw}") indicate circadian drift. Implement evening light depletion and complete a Psychomotor Vigilance Task (PVT).`,
        earthConsultUrgency: 'routine_downlink',
        guidedSteps: [
          {
            id: 'beh-sym-1',
            stepNumber: 1,
            title: 'Engage 480nm-Depleted Evening Habitat Lighting',
            plainInstruction:
              'Switch crew quarters Solid-State Lighting to low-intensity warm spectrum (<2700K) 90 minutes prior to scheduled sleep.',
            hardwareRequired: 'Solid-State Lighting Assembly (SSLA)',
            estimatedMinutes: 3,
          },
          {
            id: 'beh-sym-2',
            stepNumber: 2,
            title: 'Run 3-Minute Psychomotor Vigilance Task (PVT)',
            plainInstruction:
              'Complete the reaction-time test on the crew tablet to benchmark cognitive reaction time and detect attention lapses.',
            hardwareRequired: 'ARGUS Crew Tablet (PVT Module)',
            estimatedMinutes: 4,
          },
          {
            id: 'beh-sym-3',
            stepNumber: 3,
            title: 'Inspect Sleep Quarters Acoustic Baffles & Airflow',
            plainInstruction:
              'Verify ventilation fan speed is set to quiet night mode and deploy acoustic ear plugs.',
            hardwareRequired: 'Crew Sleeping Quarters Panel',
            estimatedMinutes: 3,
          },
        ],
        source: 'offline_verified_cache',
      };
    }
  }

  // 4. General Medical Query Fallback
  return {
    zoneId: fallbackZoneId,
    environment,
    scenarioId,
    triageStatus: 'yellow',
    headline: `Autonomous Clinical Guidance: Crew Query Recorded (${raw.slice(0, 40)}${raw.length > 40 ? '…' : ''})`,
    hazardContextSummary: `During deep-space 0g transit (comm delay 14m 22s), crew queries are evaluated against deterministic spaceflight protocols.`,
    plainLanguageExplanation: `You entered: "${raw}". The Autonomous Flight Surgeon has logged your question. Review the recommended self-exam steps below and append observations to the Earth telemetry packet.`,
    earthConsultUrgency: 'priority_packet',
    guidedSteps: [
      {
        id: 'gen-sym-1',
        stepNumber: 1,
        title: 'Review Selected Zone Telemetry & Recent Drift',
        plainInstruction:
          'Inspect the 30-day vital sign trends in the Trends tab to assess whether current physiological values deviate from your pre-flight baseline.',
        hardwareRequired: 'ARGUS Bio-Twin HUD',
        estimatedMinutes: 5,
      },
      {
        id: 'gen-sym-2',
        stepNumber: 2,
        title: 'Perform Corroborating Visual Self-Exam or Vital Check-In',
        plainInstruction:
          'Capture an optical/ultrasound image or log manual readings in the Check-In tab to provide fresh clinical data.',
        hardwareRequired: 'Crew Tablet / Ultrasound Probe',
        estimatedMinutes: 6,
      },
      {
        id: 'gen-sym-3',
        stepNumber: 3,
        title: 'Attach Clinical Remarks & Queue Earth Packet',
        plainInstruction:
          'Review the Earth packet card, ensure your symptoms and questions are documented in crew notes, and queue the packet for asynchronous ground review.',
        hardwareRequired: 'ARGUS Earth Telemetry Buffer',
        estimatedMinutes: 3,
      },
    ],
    source: 'offline_verified_cache',
  };
}
