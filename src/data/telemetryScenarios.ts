/**
 * ARGUS — Synthetic 30-Day Longitudinal Telemetry Scenarios, Offline Clinical Protocols & Visual Self-Exam Samples
 * Single Source of Truth: specs/01-data-schema.md & specs/02-ui-dashboard.md
 */

import {
  BiologicalSex,
  BodyZoneId,
  BodyZoneMetadata,
  CrewMemberProfile,
  FlightSurgeonGuidance,
  GravityEnvironment,
  ScenarioDefinition,
  ScenarioId,
  TelemetryHistoryPoint,
  TriageStatus,
  VitalSignReading,
  VisualExamSample,
} from '../types/argus';
import { evaluateZoneStatus } from '../utils/triageEngine';

export const DEFAULT_CREW_ROSTER: CrewMemberProfile[] = [
  {
    id: 'crew-vance',
    name: 'CDR Elena Vance',
    callsign: 'VALKYRIE',
    role: 'Mission Commander',
    sex: 'female',
    age: 41,
    bloodType: 'O+',
    restingHrBaselineBpm: 61,
    preFlightOnsdMm: 4.8,
    missionDaysLogged: 142,
    countermeasureStreakSols: 18,
    defaultScenarioId: 'nominal',
    medicalNotes:
      '2nd long-duration flight (ISS + Ares Transit). Strong ARED compliance; mild orthostatic sensitivity on post-landing tilt test.',
  },
  {
    id: 'crew-chen',
    name: 'FE Marcus Chen',
    callsign: 'APEX',
    role: 'Flight Engineer',
    sex: 'male',
    age: 37,
    bloodType: 'A+',
    restingHrBaselineBpm: 64,
    preFlightOnsdMm: 5.05,
    missionDaysLogged: 142,
    countermeasureStreakSols: 12,
    defaultScenarioId: 'sans_alert',
    medicalNotes:
      'Prior +0.75D hyperopic shift during 6-month orbital stay; closely monitored for SANS optic nerve sheath distension.',
  },
  {
    id: 'crew-okafor',
    name: 'Dr. Amara Okafor',
    callsign: 'PULSE',
    role: 'Flight Surgeon / Medical Officer',
    sex: 'female',
    age: 35,
    bloodType: 'B+',
    restingHrBaselineBpm: 58,
    preFlightOnsdMm: 4.7,
    missionDaysLogged: 142,
    countermeasureStreakSols: 24,
    defaultScenarioId: 'high_co2',
    medicalNotes:
      'Endurance marathoner baseline (resting bradycardia 58 bpm). Sensitive to nocturnal CO₂ pockets in rack B-2.',
  },
  {
    id: 'crew-lindqvist',
    name: 'MS Sofia Lindqvist',
    callsign: 'SOLARIS',
    role: 'EVA Surface Specialist',
    sex: 'female',
    age: 39,
    bloodType: 'O-',
    restingHrBaselineBpm: 63,
    preFlightOnsdMm: 4.85,
    missionDaysLogged: 142,
    countermeasureStreakSols: 15,
    defaultScenarioId: 'solar_storm',
    medicalNotes:
      'Lead external robotics & geology EVA specialist; logged 28 hours external suit time with elevated cumulative dosimetry.',
  },
];

export const BODY_ZONES: Record<BodyZoneId, BodyZoneMetadata> = {
  neuro: {
    id: 'neuro',
    name: 'Neuro-Ocular & CNS',
    shortLabel: 'NEURO / SANS',
    anatomicalSubtitle: 'Brain, Optic Nerve Sheath & Cerebral Perfusion',
    nasaHazardFocus:
      'Spaceflight-Associated Neuro-ocular Syndrome (SANS), cephalad fluid shift, and CO₂-induced cerebral vasodilation.',
  },
  cardio: {
    id: 'cardio',
    name: 'Cardiovascular & Pulmonary',
    shortLabel: 'CARDIO / VASC',
    anatomicalSubtitle: 'Myocardium, Thoracic Aorta & Gas Exchange',
    nasaHazardFocus:
      'Aerobic deconditioning, autonomic baroreflex shift, orthostatic intolerance on planetary entry, and hypoxia.',
  },
  musculo: {
    id: 'musculo',
    name: 'Musculoskeletal & Spine',
    shortLabel: 'MUSCULO / BONE',
    anatomicalSubtitle: 'Vertebral Column, Femoral Neck & Load Muscle',
    nasaHazardFocus:
      'Unloaded osteoclastic bone mineral loss (~1–1.5%/mo in 0g), intervertebral disc expansion, and EVA suit strain.',
  },
  immune: {
    id: 'immune',
    name: 'Immune, Radiation & Dermal',
    shortLabel: 'IMMUNE / RAD',
    anatomicalSubtitle: 'Lymphatic Core, Bone Marrow & Dermal Barrier',
    nasaHazardFocus:
      'Galactic cosmic rays (GCR), acute Solar Particle Events (SPE), latent viral reactivation, and closed-cabin dermatitis.',
  },
  behavioral: {
    id: 'behavioral',
    name: 'Behavioral & Circadian',
    shortLabel: 'BEHAV / SLEEP',
    anatomicalSubtitle: 'Neural Halo, Circadian Pacemaker & Vigilance',
    nasaHazardFocus:
      'Martian 24h 39m sol desynchrony, sleep fragmentation, CO₂ cognitive fog, and high-autonomy isolation stress.',
  },
};

export const ZONE_ORDER: BodyZoneId[] = [
  'neuro',
  'cardio',
  'musculo',
  'immune',
  'behavioral',
];

/**
 * Deterministic helper to generate a 30-day longitudinal series with smooth progression
 * and realistic physiological micro-variability.
 */
function build30DaySeries(
  startVal: number,
  endVal: number,
  precision: number = 1,
  waveAmp: number = 0.08,
  lateSpikeStartDay: number = 18
): TelemetryHistoryPoint[] {
  const points: TelemetryHistoryPoint[] = [];
  for (let day = 1; day <= 30; day++) {
    let t = (day - 1) / 29;
    // Allow steeper drift after day 18 for crisis scenarios
    if (Math.abs(endVal - startVal) > 0.5 && day >= lateSpikeStartDay) {
      const lateT = (day - lateSpikeStartDay) / (30 - lateSpikeStartDay);
      t = 0.35 + 0.65 * Math.pow(lateT, 1.25);
    } else if (Math.abs(endVal - startVal) > 0.5) {
      t = 0.35 * ((day - 1) / Math.max(1, lateSpikeStartDay - 1));
    }
    const wave = Math.sin(day * 1.15) * waveAmp + Math.cos(day * 0.6) * (waveAmp * 0.5);
    const raw = day === 30 ? endVal : startVal + (endVal - startVal) * t + wave;
    const factor = Math.pow(10, precision);
    points.push({
      missionDay: day,
      dateLabel: `MD-${day}`,
      value: Math.round(raw * factor) / factor,
    });
  }
  return points;
}

export const TELEMETRY_SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  nominal: {
    id: 'nominal',
    label: 'Nominal Deep-Space Cruise',
    shortTag: 'NOMINAL',
    description:
      'All 5 physiological zones remain within expected spaceflight norms across active countermeasures.',
    recommendedFocusZone: 'neuro',
    zones: {
      neuro: [
        {
          metricId: 'onsd',
          label: 'Optic Nerve Sheath Diam.',
          unit: 'mm',
          currentValue: 5.1,
          deltaFromBaseline: '+0.3 mm vs Pre-Flight',
          flightNormLabel: '0g Norm: 4.5–5.5 mm',
          plainDescription:
            'Ultrasound width of the fluid wrapper behind the eye. Rises when headward fluid shift increases brain pressure.',
          history: build30DaySeries(4.8, 5.1, 2, 0.05),
        },
        {
          metricId: 'iop',
          label: 'Intraocular Pressure',
          unit: 'mmHg',
          currentValue: 15.2,
          deltaFromBaseline: '+1.2 mmHg vs Pre-Flight',
          flightNormLabel: '0g Norm: 11–18 mmHg',
          plainDescription:
            'Fluid pressure inside the eyeball measured via handheld tonometer.',
          history: build30DaySeries(14.0, 15.2, 1, 0.3),
        },
        {
          metricId: 'cabin_co2',
          label: 'Inspired ppCO₂',
          unit: 'mmHg',
          currentValue: 2.4,
          deltaFromBaseline: 'CDRA Scrubber Nominal',
          flightNormLabel: '0g Norm: 1.5–3.5 mmHg',
          plainDescription:
            'Ambient carbon dioxide partial pressure. High CO₂ dilates cerebral blood vessels and worsens SANS headaches.',
          history: build30DaySeries(2.2, 2.4, 2, 0.1),
        },
      ],
      cardio: [
        {
          metricId: 'resting_hr',
          label: 'Resting Heart Rate',
          unit: 'bpm',
          currentValue: 61,
          deltaFromBaseline: '-2 bpm vs Pre-Flight',
          flightNormLabel: '0g Norm: 52–74 bpm',
          plainDescription:
            'Baseline heart rate during rest. Reflects autonomic balance and aerobic conditioning.',
          history: build30DaySeries(63, 61, 0, 1.5),
        },
        {
          metricId: 'hrv_rmssd',
          label: 'Heart Rate Variability',
          unit: 'ms',
          currentValue: 58,
          deltaFromBaseline: '+3 ms vs 30d Avg',
          flightNormLabel: '0g Norm: 42–85 ms',
          plainDescription:
            'Beat-to-beat vagal recovery index. Higher values indicate strong parasympathetic recovery.',
          history: build30DaySeries(55, 58, 0, 2.5),
        },
        {
          metricId: 'spo2',
          label: 'Arterial SpO₂',
          unit: '%',
          currentValue: 98.4,
          deltaFromBaseline: 'Stable Normoxic',
          flightNormLabel: '0g Norm: 96–100 %',
          plainDescription:
            'Blood oxygen saturation measured via optical bio-monitor.',
          history: build30DaySeries(98.5, 98.4, 1, 0.2),
        },
        {
          metricId: 'systolic_bp',
          label: 'Systolic Blood Pressure',
          unit: 'mmHg',
          currentValue: 118,
          deltaFromBaseline: 'Autonomic Vascular Tone Stable',
          flightNormLabel: '0g Norm: 100–130 mmHg',
          plainDescription:
            'Brachial systolic blood pressure. Reflects arterial compliance and cephalad vascular tone.',
          history: build30DaySeries(120, 118, 0, 1.2),
        },
      ],
      musculo: [
        {
          metricId: 'bmd_delta',
          label: 'Femoral BMD Monthly Δ',
          unit: '%',
          currentValue: -0.35,
          deltaFromBaseline: 'Mitigated via ARED',
          flightNormLabel: '0g Norm: -0.8–0.2 %',
          plainDescription:
            'Estimated monthly change in hip bone mineral density derived from urinary calcium & load telemetry.',
          history: build30DaySeries(-0.2, -0.35, 2, 0.03),
        },
        {
          metricId: 'ared_load',
          label: 'Daily ARED Resistance Load',
          unit: 'kN·reps',
          currentValue: 24.2,
          deltaFromBaseline: '104% of Target Protocol',
          flightNormLabel: '0g Norm: 18–30 kN·reps',
          plainDescription:
            'Total resistive exercise impulse logged on the Advanced Resistive Exercise Device.',
          history: build30DaySeries(22.5, 24.2, 1, 1.1),
        },
        {
          metricId: 'blood_glucose',
          label: 'Blood Glucose',
          unit: 'mg/dL',
          currentValue: 92,
          deltaFromBaseline: 'Euglycemic Post-ARED',
          flightNormLabel: '0g Norm: 70–110 mg/dL',
          plainDescription:
            'Fasting blood glucose concentration. Tracks metabolic insulin sensitivity in unloaded muscle.',
          history: build30DaySeries(89, 92, 0, 1.5),
        },
      ],
      immune: [
        {
          metricId: 'rad_dose',
          label: '24h Radiation Dose Rate',
          unit: 'mSv/d',
          currentValue: 0.68,
          deltaFromBaseline: 'Quiet Solar Baseline',
          flightNormLabel: '0g Norm: 0.4–1.2 mSv/d',
          plainDescription:
            'Personal active dosimeter reading combining Galactic Cosmic Rays (GCR) and secondary shielding scatter.',
          history: build30DaySeries(0.64, 0.68, 2, 0.04),
        },
        {
          metricId: 'wbc_lymph',
          label: 'Lymphocyte Count',
          unit: 'k/µL',
          currentValue: 2.35,
          deltaFromBaseline: 'Immune Panel Stable',
          flightNormLabel: '0g Norm: 1.5–3.5 k/µL',
          plainDescription:
            'Point-of-care fingerstick white blood cell lymphocyte concentration.',
          history: build30DaySeries(2.42, 2.35, 2, 0.06),
        },
        {
          metricId: 'core_temp',
          label: 'Core Body Temperature',
          unit: '°C',
          currentValue: 37.1,
          deltaFromBaseline: 'Normothermic Circadian Setpoint',
          flightNormLabel: '0g Norm: 36.5–37.5 °C',
          plainDescription:
            'Deep core body temperature. Evaluates thermoregulation and persistent spaceflight micro-inflammation.',
          history: build30DaySeries(36.9, 37.1, 1, 0.05),
        },
      ],
      behavioral: [
        {
          metricId: 'sleep_eff',
          label: 'Circadian Sleep Efficiency',
          unit: '%',
          currentValue: 88.5,
          deltaFromBaseline: '7h 24m Restorative',
          flightNormLabel: '0g Norm: 82–96 %',
          plainDescription:
            'Percentage of scheduled sleep period spent asleep via actigraphy & headband EEG.',
          history: build30DaySeries(87.0, 88.5, 1, 1.2),
        },
        {
          metricId: 'pvt_lapses',
          label: 'Psychomotor Vigilance Lapses',
          unit: 'lapses',
          currentValue: 1,
          deltaFromBaseline: 'Reaction Time 242 ms',
          flightNormLabel: '0g Norm: 0–2 lapses',
          plainDescription:
            'Attention delays (>500ms) during 3-minute morning reaction test.',
          history: build30DaySeries(1, 1, 0, 0.4),
        },
        {
          metricId: 'daily_sleep_hours',
          label: 'Daily Sleep Duration',
          unit: 'hours',
          currentValue: 7.4,
          deltaFromBaseline: 'Restorative Sleep Cycle',
          flightNormLabel: '0g Norm: 7.0–9.0 hours',
          plainDescription:
            'Total daily consolidated sleep duration logged via smart actigraphy.',
          history: build30DaySeries(7.2, 7.4, 1, 0.2),
        },
        {
          metricId: 'mood_index',
          label: 'Behavioral Mood Index',
          unit: '/10',
          currentValue: 8.5,
          deltaFromBaseline: 'High Mission Morale',
          flightNormLabel: '0g Norm: 7.0–10.0 /10',
          plainDescription:
            'Standardized psychological self-assessment index of mood, morale, and cognitive stress.',
          history: build30DaySeries(8.1, 8.5, 1, 0.2),
        },
      ],
    },
  },

  sans_alert: {
    id: 'sans_alert',
    label: 'SANS Optic Disc Edema Alert',
    shortTag: 'SANS ALERT',
    description:
      'Progressive cephalad fluid shift causing critical Optic Nerve Sheath distension (6.4 mm), globe flattening, and hyperopic visual shift.',
    recommendedFocusZone: 'neuro',
    zones: {
      neuro: [
        {
          metricId: 'onsd',
          label: 'Optic Nerve Sheath Diam.',
          unit: 'mm',
          currentValue: 6.42,
          deltaFromBaseline: '+1.62 mm vs Pre-Flight (CRITICAL)',
          flightNormLabel: '0g Norm: 4.5–5.5 mm',
          plainDescription:
            'Optic nerve sheath exceeds 6.0 mm critical SANS threshold, indicating elevated intracranial fluid pressure around the optic disc.',
          history: build30DaySeries(4.95, 6.42, 2, 0.06, 17),
        },
        {
          metricId: 'iop',
          label: 'Intraocular Pressure',
          unit: 'mmHg',
          currentValue: 22.8,
          deltaFromBaseline: '+8.8 mmHg vs Pre-Flight',
          flightNormLabel: '0g Norm: 11–18 mmHg',
          plainDescription:
            'Elevated intraocular pressure secondary to cephalad venous congestion.',
          history: build30DaySeries(14.5, 22.8, 1, 0.35, 18),
        },
        {
          metricId: 'cabin_co2',
          label: 'Inspired ppCO₂',
          unit: 'mmHg',
          currentValue: 3.9,
          deltaFromBaseline: '+1.5 mmHg Local Pocket',
          flightNormLabel: '0g Norm: 1.5–3.5 mmHg',
          plainDescription:
            'Mildly elevated sleeping-quarters CO₂ pocket amplifying cerebral blood flow.',
          history: build30DaySeries(2.4, 3.9, 2, 0.12, 20),
        },
      ],
      cardio: [
        {
          metricId: 'resting_hr',
          label: 'Resting Heart Rate',
          unit: 'bpm',
          currentValue: 76,
          deltaFromBaseline: '+13 bpm Autonomic Shift',
          flightNormLabel: '0g Norm: 52–74 bpm',
          plainDescription:
            'Mild compensatory heart rate elevation accompanying jugular venous distension.',
          history: build30DaySeries(62, 76, 0, 1.5, 19),
        },
        {
          metricId: 'hrv_rmssd',
          label: 'Heart Rate Variability',
          unit: 'ms',
          currentValue: 39,
          deltaFromBaseline: '-16 ms Vagal Dip',
          flightNormLabel: '0g Norm: 42–85 ms',
          plainDescription:
            'Reduced parasympathetic variability due to cranial pressure discomfort and poor sleep.',
          history: build30DaySeries(56, 39, 0, 2.0, 19),
        },
        {
          metricId: 'spo2',
          label: 'Arterial SpO₂',
          unit: '%',
          currentValue: 97.8,
          deltaFromBaseline: 'Normoxic',
          flightNormLabel: '0g Norm: 96–100 %',
          plainDescription: 'Arterial oxygen saturation remains within normal bounds.',
          history: build30DaySeries(98.4, 97.8, 1, 0.2),
        },
        {
          metricId: 'systolic_bp',
          label: 'Systolic Blood Pressure',
          unit: 'mmHg',
          currentValue: 134,
          deltaFromBaseline: '+14 mmHg Cephalad Vascular Congestion',
          flightNormLabel: '0g Norm: 100–130 mmHg',
          plainDescription:
            'Elevated brachial systolic pressure associated with cephalad fluid redistribution and jugular engorgement.',
          history: build30DaySeries(120, 134, 0, 1.2, 19),
        },
      ],
      musculo: [
        {
          metricId: 'bmd_delta',
          label: 'Femoral BMD Monthly Δ',
          unit: '%',
          currentValue: -0.45,
          deltaFromBaseline: 'Within Expected 0g Drift',
          flightNormLabel: '0g Norm: -0.8–0.2 %',
          plainDescription: 'Bone remodeling rate stable; avoid high-Valsalva heavy squats during acute SANS.',
          history: build30DaySeries(-0.25, -0.45, 2, 0.03),
        },
        {
          metricId: 'ared_load',
          label: 'Daily ARED Resistance Load',
          unit: 'kN·reps',
          currentValue: 21.0,
          deltaFromBaseline: 'Modified for ICP Safety',
          flightNormLabel: '0g Norm: 18–30 kN·reps',
          plainDescription: 'Resistive load moderated to avoid transient intracranial pressure spikes.',
          history: build30DaySeries(24.0, 21.0, 1, 0.8),
        },
        {
          metricId: 'blood_glucose',
          label: 'Blood Glucose',
          unit: 'mg/dL',
          currentValue: 96,
          deltaFromBaseline: 'Fasting Glucose Stable',
          flightNormLabel: '0g Norm: 70–110 mg/dL',
          plainDescription:
            'Metabolic glucose levels within spaceflight expectations.',
          history: build30DaySeries(90, 96, 0, 1.4),
        },
      ],
      immune: [
        {
          metricId: 'rad_dose',
          label: '24h Radiation Dose Rate',
          unit: 'mSv/d',
          currentValue: 0.72,
          deltaFromBaseline: 'Nominal GCR Flux',
          flightNormLabel: '0g Norm: 0.4–1.2 mSv/d',
          plainDescription: 'Background cosmic radiation within nominal transit corridor.',
          history: build30DaySeries(0.65, 0.72, 2, 0.04),
        },
        {
          metricId: 'wbc_lymph',
          label: 'Lymphocyte Count',
          unit: 'k/µL',
          currentValue: 2.28,
          deltaFromBaseline: 'Nominal',
          flightNormLabel: '0g Norm: 1.5–3.5 k/µL',
          plainDescription: 'White blood cell count within normal range.',
          history: build30DaySeries(2.4, 2.28, 2, 0.05),
        },
        {
          metricId: 'core_temp',
          label: 'Core Body Temperature',
          unit: '°C',
          currentValue: 37.2,
          deltaFromBaseline: 'Mild Circadian Shift',
          flightNormLabel: '0g Norm: 36.5–37.5 °C',
          plainDescription:
            'Deep core body temperature within normal range.',
          history: build30DaySeries(36.9, 37.2, 1, 0.05),
        },
      ],
      behavioral: [
        {
          metricId: 'sleep_eff',
          label: 'Circadian Sleep Efficiency',
          unit: '%',
          currentValue: 76.5,
          deltaFromBaseline: '-11.5% Frontal Headache',
          flightNormLabel: '0g Norm: 82–96 %',
          plainDescription: 'Sleep fragmented by supine/0g cranial fullness and mild photophobia.',
          history: build30DaySeries(88.0, 76.5, 1, 1.4, 18),
        },
        {
          metricId: 'pvt_lapses',
          label: 'Psychomotor Vigilance Lapses',
          unit: 'lapses',
          currentValue: 3,
          deltaFromBaseline: '+2 Near-Vision Strain',
          flightNormLabel: '0g Norm: 0–2 lapses',
          plainDescription: 'Mild increase in visual reaction lapses linked to hyperopic focus shift.',
          history: build30DaySeries(1, 3, 0, 0.3, 20),
        },
        {
          metricId: 'daily_sleep_hours',
          label: 'Daily Sleep Duration',
          unit: 'hours',
          currentValue: 6.3,
          deltaFromBaseline: '-1.1h SANS Headache Disruptions',
          flightNormLabel: '0g Norm: 7.0–9.0 hours',
          plainDescription:
            'Curtailment of total sleep duration caused by cephalad pressure and nocturnal throbbing headache.',
          history: build30DaySeries(7.3, 6.3, 1, 0.2, 18),
        },
        {
          metricId: 'mood_index',
          label: 'Behavioral Mood Index',
          unit: '/10',
          currentValue: 6.0,
          deltaFromBaseline: '-2.2 pts Visual Concern',
          flightNormLabel: '0g Norm: 7.0–10.0 /10',
          plainDescription:
            'Elevated crew anxiety and discomfort related to SANS visual acuity shift.',
          history: build30DaySeries(8.2, 6.0, 1, 0.2, 18),
        },
      ],
    },
  },

  high_co2: {
    id: 'high_co2',
    label: 'Habitat CO₂ Scrubber Degradation',
    shortTag: 'HIGH CO₂ (5.8 mmHg)',
    description:
      'Zeolite sorbent saturation in life-support loop raising cabin ppCO₂ to 5.8 mmHg — triggering hypercapnic cerebral vasodilation, tachycardia, and cognitive fog.',
    recommendedFocusZone: 'neuro',
    zones: {
      neuro: [
        {
          metricId: 'cabin_co2',
          label: 'Inspired ppCO₂',
          unit: 'mmHg',
          currentValue: 5.8,
          deltaFromBaseline: '+3.4 mmHg SCRUBBER FAULT',
          flightNormLabel: '0g Norm: 1.5–3.5 mmHg',
          plainDescription:
            'Critical cabin CO₂ buildup (>4.5 mmHg limit). Directly dilates brain arteries and impairs executive decision-making.',
          history: build30DaySeries(2.3, 5.8, 2, 0.15, 21),
        },
        {
          metricId: 'onsd',
          label: 'Optic Nerve Sheath Diam.',
          unit: 'mm',
          currentValue: 5.82,
          deltaFromBaseline: '+1.02 mm Hypercapnic Shift',
          flightNormLabel: '0g Norm: 4.5–5.5 mm',
          plainDescription:
            'Elevated optic nerve sheath diameter driven by CO₂-mediated cerebral vasodilation.',
          history: build30DaySeries(4.9, 5.82, 2, 0.06, 21),
        },
        {
          metricId: 'iop',
          label: 'Intraocular Pressure',
          unit: 'mmHg',
          currentValue: 19.4,
          deltaFromBaseline: '+5.4 mmHg vs Baseline',
          flightNormLabel: '0g Norm: 11–18 mmHg',
          plainDescription: 'Moderately elevated intraocular pressure.',
          history: build30DaySeries(14.2, 19.4, 1, 0.3, 21),
        },
      ],
      cardio: [
        {
          metricId: 'resting_hr',
          label: 'Resting Heart Rate',
          unit: 'bpm',
          currentValue: 88,
          deltaFromBaseline: '+26 bpm Sympathetic Surge',
          flightNormLabel: '0g Norm: 52–74 bpm',
          plainDescription:
            'Hypercapnic chemoreceptor reflex driving resting tachycardia and increased respiratory drive.',
          history: build30DaySeries(61, 88, 0, 1.8, 22),
        },
        {
          metricId: 'hrv_rmssd',
          label: 'Heart Rate Variability',
          unit: 'ms',
          currentValue: 29,
          deltaFromBaseline: '-29 ms Chemoreflex Stress',
          flightNormLabel: '0g Norm: 42–85 ms',
          plainDescription: 'Markedly suppressed heart rate variability under CO₂ respiratory load.',
          history: build30DaySeries(57, 29, 0, 2.0, 21),
        },
        {
          metricId: 'spo2',
          label: 'Arterial SpO₂',
          unit: '%',
          currentValue: 94.2,
          deltaFromBaseline: '-4.2% vs Baseline',
          flightNormLabel: '0g Norm: 96–100 %',
          plainDescription: 'Mild drop in peripheral oxygen saturation amidst cabin gas imbalance.',
          history: build30DaySeries(98.4, 94.2, 1, 0.25, 22),
        },
        {
          metricId: 'systolic_bp',
          label: 'Systolic Blood Pressure',
          unit: 'mmHg',
          currentValue: 138,
          deltaFromBaseline: '+18 mmHg Sympathetic Hypercapnic Surge',
          flightNormLabel: '0g Norm: 100–130 mmHg',
          plainDescription:
            'Hypercapnia-driven sympathetic vasoconstriction and elevated systemic blood pressure.',
          history: build30DaySeries(122, 138, 0, 1.5, 21),
        },
      ],
      musculo: [
        {
          metricId: 'bmd_delta',
          label: 'Femoral BMD Monthly Δ',
          unit: '%',
          currentValue: -0.52,
          deltaFromBaseline: 'Acid-Base Buffering Drift',
          flightNormLabel: '0g Norm: -0.8–0.2 %',
          plainDescription: 'Mild respiratory acidosis increases bone carbonate mobilization.',
          history: build30DaySeries(-0.3, -0.52, 2, 0.03),
        },
        {
          metricId: 'ared_load',
          label: 'Daily ARED Resistance Load',
          unit: 'kN·reps',
          currentValue: 14.5,
          deltaFromBaseline: '-9.7 kN·reps Dyspnea',
          flightNormLabel: '0g Norm: 18–30 kN·reps',
          plainDescription: 'Exercise volume curtailed due to exertional shortness of breath in high CO₂.',
          history: build30DaySeries(24.0, 14.5, 1, 1.0, 22),
        },
        {
          metricId: 'blood_glucose',
          label: 'Blood Glucose',
          unit: 'mg/dL',
          currentValue: 104,
          deltaFromBaseline: 'Mild Sympathetic Glycemia',
          flightNormLabel: '0g Norm: 70–110 mg/dL',
          plainDescription:
            'Slight elevation in fasting glucose secondary to systemic hypercapnic stress response.',
          history: build30DaySeries(90, 104, 0, 1.3, 22),
        },
      ],
      immune: [
        {
          metricId: 'rad_dose',
          label: '24h Radiation Dose Rate',
          unit: 'mSv/d',
          currentValue: 0.69,
          deltaFromBaseline: 'Nominal GCR Flux',
          flightNormLabel: '0g Norm: 0.4–1.2 mSv/d',
          plainDescription: 'Radiation environment nominal.',
          history: build30DaySeries(0.65, 0.69, 2, 0.04),
        },
        {
          metricId: 'wbc_lymph',
          label: 'Lymphocyte Count',
          unit: 'k/µL',
          currentValue: 2.15,
          deltaFromBaseline: 'Nominal',
          flightNormLabel: '0g Norm: 1.5–3.5 k/µL',
          plainDescription: 'Immune cell counts within normal limits.',
          history: build30DaySeries(2.35, 2.15, 2, 0.05),
        },
        {
          metricId: 'core_temp',
          label: 'Core Body Temperature',
          unit: '°C',
          currentValue: 37.4,
          deltaFromBaseline: 'Hypercapnic Cutaneous Vasodilation',
          flightNormLabel: '0g Norm: 36.5–37.5 °C',
          plainDescription:
            'Core temperature slightly elevated under increased work of breathing.',
          history: build30DaySeries(36.9, 37.4, 1, 0.05, 22),
        },
      ],
      behavioral: [
        {
          metricId: 'sleep_eff',
          label: 'Circadian Sleep Efficiency',
          unit: '%',
          currentValue: 68.0,
          deltaFromBaseline: '-20.5% Hypercapnic Arousal',
          flightNormLabel: '0g Norm: 82–96 %',
          plainDescription:
            'Severe sleep fragmentation and morning throbbing headache caused by nocturnal CO₂ pooling.',
          history: build30DaySeries(88.0, 68.0, 1, 1.5, 21),
        },
        {
          metricId: 'pvt_lapses',
          label: 'Psychomotor Vigilance Lapses',
          unit: 'lapses',
          currentValue: 6,
          deltaFromBaseline: '+5 Cognitive Slowing (RED)',
          flightNormLabel: '0g Norm: 0–2 lapses',
          plainDescription:
            'Critical rise in reaction lapses; crew at elevated risk for procedural errors during EVA/maintenance.',
          history: build30DaySeries(1, 6, 0, 0.4, 21),
        },
        {
          metricId: 'daily_sleep_hours',
          label: 'Daily Sleep Duration',
          unit: 'hours',
          currentValue: 5.4,
          deltaFromBaseline: '-2.0h Nocturnal CO₂ Awakenings (RED)',
          flightNormLabel: '0g Norm: 7.0–9.0 hours',
          plainDescription:
            'Critical sleep disruption and recurrent arousals driven by high ambient carbon dioxide.',
          history: build30DaySeries(7.3, 5.4, 1, 0.25, 21),
        },
        {
          metricId: 'mood_index',
          label: 'Behavioral Mood Index',
          unit: '/10',
          currentValue: 4.5,
          deltaFromBaseline: '-3.8 pts Severe Irritability & Fog (RED)',
          flightNormLabel: '0g Norm: 7.0–10.0 /10',
          plainDescription:
            'Pronounced executive cognitive slowing, lethargy, and affective irritability from elevated ppCO₂.',
          history: build30DaySeries(8.1, 4.5, 1, 0.25, 21),
        },
      ],
    },
  },

  solar_storm: {
    id: 'solar_storm',
    label: 'SPE Radiation Storm Alert',
    shortTag: 'SOLAR STORM (SPE)',
    description:
      'X-Class coronal mass ejection proton event raising habitat dose rate to 4.85 mSv/d — triggering acute hematopoietic lymphocyte suppression and dermal/ocular radiation countermeasures.',
    recommendedFocusZone: 'immune',
    zones: {
      immune: [
        {
          metricId: 'rad_dose',
          label: '24h Radiation Dose Rate',
          unit: 'mSv/d',
          currentValue: 4.85,
          deltaFromBaseline: '+4.17 mSv/d SPE PROTON FLUX',
          flightNormLabel: '0g Norm: 0.4–1.2 mSv/d',
          plainDescription:
            'Critical solar proton flux detected by crew dosimeter. Immediate water-wall storm shelter occupancy required.',
          history: build30DaySeries(0.66, 4.85, 2, 0.08, 24),
        },
        {
          metricId: 'wbc_lymph',
          label: 'Lymphocyte Count',
          unit: 'k/µL',
          currentValue: 1.05,
          deltaFromBaseline: '-1.30 k/µL Lymphopenia',
          flightNormLabel: '0g Norm: 1.5–3.5 k/µL',
          plainDescription:
            'Radiation-sensitive lymphocyte drop below 1.2 k/µL threshold, indicating acute hematopoietic stress.',
          history: build30DaySeries(2.38, 1.05, 2, 0.06, 24),
        },
        {
          metricId: 'core_temp',
          label: 'Core Body Temperature',
          unit: '°C',
          currentValue: 37.9,
          deltaFromBaseline: '+1.0 °C Radiation Cytokine Pyrexia',
          flightNormLabel: '0g Norm: 36.5–37.5 °C',
          plainDescription:
            'Mild systemic pyrexia secondary to acute solar proton exposure and radiation inflammatory cascade.',
          history: build30DaySeries(36.8, 37.9, 1, 0.08, 24),
        },
      ],
      neuro: [
        {
          metricId: 'onsd',
          label: 'Optic Nerve Sheath Diam.',
          unit: 'mm',
          currentValue: 5.38,
          deltaFromBaseline: '+0.58 mm vs Baseline',
          flightNormLabel: '0g Norm: 4.5–5.5 mm',
          plainDescription:
            'Upper-nominal optic nerve sheath; crew reporting retinal phosphene light flashes from energetic ions.',
          history: build30DaySeries(4.9, 5.38, 2, 0.05, 23),
        },
        {
          metricId: 'iop',
          label: 'Intraocular Pressure',
          unit: 'mmHg',
          currentValue: 16.5,
          deltaFromBaseline: '+2.5 mmHg vs Baseline',
          flightNormLabel: '0g Norm: 11–18 mmHg',
          plainDescription: 'Intraocular pressure stable inside shelter.',
          history: build30DaySeries(14.2, 16.5, 1, 0.3),
        },
        {
          metricId: 'cabin_co2',
          label: 'Inspired ppCO₂',
          unit: 'mmHg',
          currentValue: 3.7,
          deltaFromBaseline: '+1.3 mmHg Shelter Crowding',
          flightNormLabel: '0g Norm: 1.5–3.5 mmHg',
          plainDescription:
            'Slightly elevated local CO₂ inside compact water-lined radiation storm shelter.',
          history: build30DaySeries(2.3, 3.7, 2, 0.1, 24),
        },
      ],
      cardio: [
        {
          metricId: 'resting_hr',
          label: 'Resting Heart Rate',
          unit: 'bpm',
          currentValue: 81,
          deltaFromBaseline: '+19 bpm Stress Response',
          flightNormLabel: '0g Norm: 52–74 bpm',
          plainDescription: 'Elevated resting heart rate during storm shelter lock-in.',
          history: build30DaySeries(62, 81, 0, 1.6, 24),
        },
        {
          metricId: 'hrv_rmssd',
          label: 'Heart Rate Variability',
          unit: 'ms',
          currentValue: 34,
          deltaFromBaseline: '-24 ms Oxidative Stress',
          flightNormLabel: '0g Norm: 42–85 ms',
          plainDescription: 'Reduced autonomic variability during acute radiation & confinement stress.',
          history: build30DaySeries(58, 34, 0, 2.0, 24),
        },
        {
          metricId: 'spo2',
          label: 'Arterial SpO₂',
          unit: '%',
          currentValue: 97.6,
          deltaFromBaseline: 'Normoxic',
          flightNormLabel: '0g Norm: 96–100 %',
          plainDescription: 'Blood oxygenation remains normal.',
          history: build30DaySeries(98.4, 97.6, 1, 0.2),
        },
        {
          metricId: 'systolic_bp',
          label: 'Systolic Blood Pressure',
          unit: 'mmHg',
          currentValue: 132,
          deltaFromBaseline: '+12 mmHg Shelter Confinement Stress',
          flightNormLabel: '0g Norm: 100–130 mmHg',
          plainDescription:
            'Transient sympathetic elevation during radiation storm shelter lockdown.',
          history: build30DaySeries(120, 132, 0, 1.2, 24),
        },
      ],
      musculo: [
        {
          metricId: 'bmd_delta',
          label: 'Femoral BMD Monthly Δ',
          unit: '%',
          currentValue: -0.92,
          deltaFromBaseline: 'Unloaded Shelter Confinement',
          flightNormLabel: '0g Norm: -0.8–0.2 %',
          plainDescription:
            'Accelerated bone resorption from suspended ARED exercise during storm shelter stay.',
          history: build30DaySeries(-0.32, -0.92, 2, 0.04, 24),
        },
        {
          metricId: 'ared_load',
          label: 'Daily ARED Resistance Load',
          unit: 'kN·reps',
          currentValue: 13.2,
          deltaFromBaseline: 'Paused Outside Storm Shelter',
          flightNormLabel: '0g Norm: 18–30 kN·reps',
          plainDescription:
            'Main ARED bay is in less-shielded module; crew restricted to compact resistive bands.',
          history: build30DaySeries(24.0, 13.2, 1, 1.2, 24),
        },
        {
          metricId: 'blood_glucose',
          label: 'Blood Glucose',
          unit: 'mg/dL',
          currentValue: 102,
          deltaFromBaseline: 'Stress Counter-Regulatory Glycemia',
          flightNormLabel: '0g Norm: 70–110 mg/dL',
          plainDescription:
            'Mild metabolic counter-regulatory hormone release during emergency shelter protocol.',
          history: build30DaySeries(91, 102, 0, 1.2, 24),
        },
      ],
      behavioral: [
        {
          metricId: 'sleep_eff',
          label: 'Circadian Sleep Efficiency',
          unit: '%',
          currentValue: 74.0,
          deltaFromBaseline: '-14.5% Confinement Alert',
          flightNormLabel: '0g Norm: 82–96 %',
          plainDescription: 'Cramped storm shelter quarters and radiation alarm monitoring reducing sleep quality.',
          history: build30DaySeries(88.2, 74.0, 1, 1.5, 24),
        },
        {
          metricId: 'pvt_lapses',
          label: 'Psychomotor Vigilance Lapses',
          unit: 'lapses',
          currentValue: 3,
          deltaFromBaseline: '+2 Fatigue Drift',
          flightNormLabel: '0g Norm: 0–2 lapses',
          plainDescription: 'Mild vigilance degradation after 48h storm shelter watch.',
          history: build30DaySeries(1, 3, 0, 0.3, 24),
        },
        {
          metricId: 'daily_sleep_hours',
          label: 'Daily Sleep Duration',
          unit: 'hours',
          currentValue: 5.8,
          deltaFromBaseline: '-1.6h Cramped Shelter Sleeping',
          flightNormLabel: '0g Norm: 7.0–9.0 hours',
          plainDescription:
            'Sleep curtailed by cramped water-wall storm shelter quarters and high vigilance alarm monitoring.',
          history: build30DaySeries(7.2, 5.8, 1, 0.25, 24),
        },
        {
          metricId: 'mood_index',
          label: 'Behavioral Mood Index',
          unit: '/10',
          currentValue: 5.2,
          deltaFromBaseline: '-2.9 pts Solar Alarm Anxiety',
          flightNormLabel: '0g Norm: 7.0–10.0 /10',
          plainDescription:
            'Acute confinement stress and elevated anxiety during prolonged solar storm alert.',
          history: build30DaySeries(8.1, 5.2, 1, 0.2, 24),
        },
      ],
    },
  },
};

/**
 * Deterministically adjusts a scenario's 5-zone telemetry readings to reflect
 * an individual crew member's pre-flight physiological baselines (`restingHrBaselineBpm`, `preFlightOnsdMm`).
 */
export function getCrewAdjustedZones(
  scenarioId: ScenarioId,
  crewMember?: CrewMemberProfile
): Record<BodyZoneId, VitalSignReading[]> {
  const baseZones = TELEMETRY_SCENARIOS[scenarioId].zones;
  if (!crewMember) {
    return baseZones;
  }

  const hrOffset = crewMember.restingHrBaselineBpm - 61;
  const onsdOffset =
    Math.round((crewMember.preFlightOnsdMm - 4.8) * 100) / 100;

  if (hrOffset === 0 && onsdOffset === 0) {
    return baseZones;
  }

  const adjustReading = (reading: VitalSignReading): VitalSignReading => {
    if (reading.metricId === 'resting_hr' && hrOffset !== 0) {
      const nextVal = Math.round(reading.currentValue + hrOffset);
      const diffFromOwnBaseline = nextVal - crewMember.restingHrBaselineBpm;
      const sign = diffFromOwnBaseline >= 0 ? '+' : '';
      return {
        ...reading,
        currentValue: nextVal,
        deltaFromBaseline: `${sign}${diffFromOwnBaseline} bpm vs ${crewMember.callsign} Baseline (${crewMember.restingHrBaselineBpm} bpm)`,
        history: reading.history.map((pt) => ({
          ...pt,
          value: Math.round(pt.value + hrOffset),
        })),
      };
    }

    if (reading.metricId === 'onsd' && onsdOffset !== 0) {
      const nextVal =
        Math.round((reading.currentValue + onsdOffset) * 100) / 100;
      const diffFromOwnBaseline =
        Math.round((nextVal - crewMember.preFlightOnsdMm) * 100) / 100;
      const sign = diffFromOwnBaseline >= 0 ? '+' : '';
      return {
        ...reading,
        currentValue: nextVal,
        deltaFromBaseline: `${sign}${diffFromOwnBaseline} mm vs ${crewMember.callsign} Baseline (${crewMember.preFlightOnsdMm} mm)`,
        history: reading.history.map((pt) => ({
          ...pt,
          value: Math.round((pt.value + onsdOffset) * 100) / 100,
        })),
      };
    }

    return reading;
  };

  return {
    neuro: baseZones.neuro.map(adjustReading),
    cardio: baseZones.cardio.map(adjustReading),
    musculo: baseZones.musculo.map(adjustReading),
    immune: baseZones.immune.map(adjustReading),
    behavioral: baseZones.behavioral.map(adjustReading),
  };
}

/**
 * Generates deterministic, NASA HRP-grounded offline FlightSurgeonGuidance
 * tailored to the active scenario, body zone, and gravity environment.
 */
export function getOfflineFlightSurgeonGuidance(
  scenarioId: ScenarioId,
  zoneId: BodyZoneId,
  environment: GravityEnvironment = '0g_transit',
  crewMember?: CrewMemberProfile
): FlightSurgeonGuidance {
  const adjustedZones = getCrewAdjustedZones(scenarioId, crewMember);
  const zoneReadings = adjustedZones[zoneId];
  const triageStatus: TriageStatus = evaluateZoneStatus(zoneReadings, environment);

  const envContextMap: Record<GravityEnvironment, string> = {
    '0g_transit':
      'In 0g Deep-Space Transit (14m 22s one-way Earth comm delay), complete weightlessness drives ~2 liters of venous fluid headward while unloading skeletal structures.',
    'iss_leo':
      'Aboard the ISS in Low Earth Orbit (real-time comm link to Mission Control), microgravity produces cephalad fluid shifts while Earth magnetosphere offers partial radiation shielding.',
    'lunar_base':
      'At the Artemis Lunar Base (1/6g partial gravity, 1.3s one-way Earth comm delay), partial weight-bearing mitigates fluid shift while lunar regolith and surface radiation pose unique operational hazards.',
    'mars_base':
      'At Mars Surface Base (3/8g partial gravity, 18m 10s one-way Earth comm delay), substantial communications latency necessitates autonomous crew clinical protocols.',
  };

  // Specific crisis guidance overrides
  if (scenarioId === 'sans_alert' && zoneId === 'neuro') {
    return {
      zoneId,
      environment,
      scenarioId,
      triageStatus,
      headline: 'CRITICAL SANS PROTOCOL: Optic Nerve Sheath Distension (6.42 mm)',
      hazardContextSummary: `${envContextMap[environment]} Persistent cranial venous pooling has distended the optic nerve sheath beyond the 6.0 mm critical threshold with elevated IOP (22.8 mmHg).`,
      plainLanguageExplanation:
        'Fluid that normally pools in your legs on Earth has shifted into your head, increasing pressure around the back of your eyes (Spaceflight-Associated Neuro-ocular Syndrome). This can flatten the eyeball and swell the optic disc if not relieved.',
      earthConsultUrgency: 'immediate_emergency_packet',
      guidedSteps: [
        {
          id: 'sans-1',
          stepNumber: 1,
          title: 'Perform Bilateral Ocular Ultrasound & Fundoscopy',
          plainInstruction:
            'Apply sterile coupling gel to closed eyelid. Use the linear probe to capture axial ONSD 3 mm posterior to the globe and attach the scan in Visual Self-Exam below.',
          hardwareRequired: 'Butterfly iQ+ / Spaceflight Eye Ultrasound',
          estimatedMinutes: 8,
        },
        {
          id: 'sans-2',
          stepNumber: 2,
          title: 'Initiate Lower Body Negative Pressure (LBNP) Session',
          plainInstruction:
            'Don the Chibis LBNP garment at -25 mmHg for 45 minutes to draw venous blood volume back toward the pelvis and lower extremities.',
          hardwareRequired: 'LBNP Countermeasure Garment',
          estimatedMinutes: 45,
        },
        {
          id: 'sans-3',
          stepNumber: 3,
          title: 'Verify Local Sleeping Rack Airflow & CO₂',
          plainInstruction:
            'Position portable fan to disperse stagnant exhaled CO₂ pockets (currently 3.9 mmHg) that dilate brain blood vessels during sleep.',
          hardwareRequired: 'Portable Habitat Air Velocity Meter & Fan',
          estimatedMinutes: 5,
        },
      ],
      source: 'offline_verified_cache',
    };
  }

  if (scenarioId === 'high_co2' && (zoneId === 'neuro' || zoneId === 'cardio' || zoneId === 'behavioral')) {
    return {
      zoneId,
      environment,
      scenarioId,
      triageStatus,
      headline: 'HYPERCAPNIA ALERT: Cabin ppCO₂ at 5.8 mmHg — Scrubber Intervention',
      hazardContextSummary: `${envContextMap[environment]} Habitat inspired CO₂ has climbed to 5.8 mmHg, driving cerebral vasodilation (ONSD 5.82 mm), sympathetic tachycardia (88 bpm), and 6 vigilance lapses.`,
      plainLanguageExplanation:
        'Excess carbon dioxide in the cabin air is causing blood vessels in your brain to widen, leading to throbbing headaches, elevated heart rate, and slower reaction times. Reduce physical exertion immediately while switching scrubbers.',
      earthConsultUrgency: 'immediate_emergency_packet',
      guidedSteps: [
        {
          id: 'co2-1',
          stepNumber: 1,
          title: 'Switch CDRA Desiccant/Adsorbent Bed & Deploy Backup LiOH',
          plainInstruction:
            'Transfer ECLSS Carbon Dioxide Removal Assembly to secondary thermal channel and insert two emergency Lithium Hydroxide (LiOH) canisters into the main cabin return duct.',
          hardwareRequired: 'ECLSS Panel + 2x Emergency LiOH Canisters',
          estimatedMinutes: 12,
        },
        {
          id: 'co2-2',
          stepNumber: 2,
          title: 'Don Portable Breathing Apparatus (O₂ Mask) for 20 Minutes',
          plainInstruction:
            'Breathe 100% dry-loop oxygen at 4 L/min while resting seated/strapped to wash out arterial CO₂ and relieve hypercapnic headache.',
          hardwareRequired: 'Crew Medical Restraint + Portable O₂ Mask',
          estimatedMinutes: 20,
        },
        {
          id: 'co2-3',
          stepNumber: 3,
          title: 'Suspend High-Exertion ARED Workouts & Re-Run 3-Min PVT',
          plainInstruction:
            'Hold heavy resistive exercise (which triples metabolic CO₂ output) until cabin ppCO₂ drops below 3.0 mmHg, then repeat vigilance check.',
          hardwareRequired: 'ARGUS Crew Tablet (PVT Module)',
          estimatedMinutes: 5,
        },
      ],
      source: 'offline_verified_cache',
    };
  }

  if (scenarioId === 'solar_storm' && (zoneId === 'immune' || zoneId === 'musculo')) {
    return {
      zoneId,
      environment,
      scenarioId,
      triageStatus,
      headline: 'SPE RADIATION SHELTER PROTOCOL: Dose Rate 4.85 mSv/d & Lymphopenia',
      hazardContextSummary: `${envContextMap[environment]} Active Solar Particle Event proton flux has spiked 24h dose rate to 4.85 mSv/d with peripheral lymphocytes dipping to 1.05 k/µL.`,
      plainLanguageExplanation:
        'An intense solar storm is bombarding the spacecraft with high-energy protons. Your white blood cell count has dipped temporarily in response to radiation stress. Stay inside the water-lined storm shelter and complete antioxidant & dermal checks.',
      earthConsultUrgency: 'immediate_emergency_packet',
      guidedSteps: [
        {
          id: 'spe-1',
          stepNumber: 1,
          title: 'Verify Water-Wall Storm Shelter Mass Shielding Configuration',
          plainInstruction:
            'Confirm potable water stowage bladders and polyethylene bricks are latched around the crew bunk perimeter (>20 g/cm² areal density).',
          hardwareRequired: 'Active Crew Personal Dosimeter (CPD)',
          estimatedMinutes: 10,
        },
        {
          id: 'spe-2',
          stepNumber: 2,
          title: 'Administer Radioprotective Antioxidant & Retinal/Dermal Check',
          plainInstruction:
            'Take scheduled oral N-acetylcysteine / vitamin C countermeasure pack from Medical Kit B, and photograph any skin erythema or rash in Visual Self-Exam.',
          hardwareRequired: 'Crew Medical Kit B + Handheld Dermascope',
          estimatedMinutes: 10,
        },
        {
          id: 'spe-3',
          stepNumber: 3,
          title: 'Run Point-of-Care Fingerstick Complete Blood Count (CBC)',
          plainInstruction:
            'Collect 20 µL capillary blood sample to track absolute lymphocyte recovery every 12 hours until proton flux subsides.',
          hardwareRequired: 'Hemocue / Microfluidic Point-of-Care Analyzer',
          estimatedMinutes: 8,
        },
      ],
      source: 'offline_verified_cache',
    };
  }

  // Default zone-specific guidance for nominal or secondary drift zones
  const defaultByZone: Record<BodyZoneId, Omit<FlightSurgeonGuidance, 'zoneId' | 'environment' | 'scenarioId' | 'triageStatus' | 'source'>> = {
    neuro: {
      headline:
        triageStatus === 'green'
          ? 'Neuro-Ocular Baseline Stable — Routine SANS Surveillance'
          : 'Elevated Neuro-Ocular Drift — Preventive ICP Countermeasures',
      hazardContextSummary: `${envContextMap[environment]} Optic nerve sheath diameter and intraocular pressure are tracked continuously to detect early Spaceflight-Associated Neuro-ocular Syndrome (SANS).`,
      plainLanguageExplanation:
        'Your brain and eye fluid pressures are adapting to 0g microgravity. Completing routine visual acuity and ultrasound checks ensures we catch any fluid buildup early.',
      earthConsultUrgency: triageStatus === 'green' ? 'routine_downlink' : 'priority_packet',
      guidedSteps: [
        {
          id: 'neuro-def-1',
          stepNumber: 1,
          title: 'Digital Amsler Grid & Near-Vision Acuity Check',
          plainInstruction:
            'Hold the tablet 40 cm from your face, cover one eye at a time, and verify no wavy lines or central blind spots appear on the grid.',
          hardwareRequired: 'ARGUS Crew Tablet',
          estimatedMinutes: 4,
        },
        {
          id: 'neuro-def-2',
          stepNumber: 2,
          title: 'Weekly Fundoscope Retinal Capture',
          plainInstruction:
            'Capture a non-mydriatic retinal fundus image (or select "Nominal Retina" below) to verify crisp optic disc margins.',
          hardwareRequired: 'Spaceflight Optical Fundoscope',
          estimatedMinutes: 6,
        },
      ],
    },
    cardio: {
      headline:
        triageStatus === 'green'
          ? 'Cardiovascular & Autonomic Telemetry Nominal'
          : 'Autonomic Shift Detected — Orthostatic & Aerobic Protocol',
      hazardContextSummary: `${envContextMap[environment]} Baroreceptor unloading alters resting vagal tone and plasma volume, requiring structured aerobic and fluid-loading countermeasures before gravity transitions.`,
      plainLanguageExplanation:
        'Your heart and blood vessels adjust to lower gravity by reducing total blood volume slightly. Regular aerobic cycling and hydration keep your circulation ready for planetary landings and EVAs.',
      earthConsultUrgency: triageStatus === 'green' ? 'routine_downlink' : 'priority_packet',
      guidedSteps: [
        {
          id: 'cardio-def-1',
          stepNumber: 1,
          title: '30-Minute Cycle Ergometer Interval Protocol',
          plainInstruction:
            'Complete 4x4 min intervals at 75–85% max HR on the CEVIS ergometer while monitoring continuous ECG lead II.',
          hardwareRequired: 'CEVIS Cycle Ergometer + Bio-Harness',
          estimatedMinutes: 30,
        },
        {
          id: 'cardio-def-2',
          stepNumber: 2,
          title: 'Isotonic Hydration & Electrolyte Bolus Check',
          plainInstruction:
            'Consume 450 mL electrolyte solution to maintain intravascular plasma volume and support HRV recovery.',
          hardwareRequired: 'Galley Hydration Dispenser',
          estimatedMinutes: 5,
        },
      ],
    },
    musculo: {
      headline:
        triageStatus === 'green'
          ? 'Musculoskeletal Loading Nominal — Osteoclastic Drift Controlled'
          : 'Reduced Skeletal Loading — Resume Resistive Countermeasures',
      hazardContextSummary: `${envContextMap[environment]} Without Earth-normal axial loading, femoral neck and lumbar spine lose bone mineral density unless countered by high-force resistive exercise.`,
      plainLanguageExplanation:
        'Your bones and postural muscles need daily heavy resistance loading so they do not weaken in reduced gravity. Keep your ARED squat and deadlift impulse inside the target zone.',
      earthConsultUrgency: triageStatus === 'green' ? 'routine_downlink' : 'priority_packet',
      guidedSteps: [
        {
          id: 'musc-def-1',
          stepNumber: 1,
          title: 'ARED Axial Squat & Heel-Raise Series',
          plainInstruction:
            'Perform 4 sets of 8 reps back squats and heel raises on vacuum cylinder flywheels with correct spinal alignment.',
          hardwareRequired: 'ARED (Advanced Resistive Exercise Device)',
          estimatedMinutes: 35,
        },
        {
          id: 'musc-def-2',
          stepNumber: 2,
          title: 'Vitamin D3 (2000 IU) & Bisphosphonate Log Verification',
          plainInstruction:
            'Confirm daily Vitamin D3 intake and ensure urinary calcium excretion strip remains below hypercalciuria threshold.',
          hardwareRequired: 'Nutritional Pack + Urine Test Strip',
          estimatedMinutes: 5,
        },
      ],
    },
    immune: {
      headline:
        triageStatus === 'green'
          ? 'Immune & Dosimetry Status Nominal'
          : 'Radiation / Immune Drift — Barrier & Hematopoietic Protocol',
      hazardContextSummary: `${envContextMap[environment]} Closed-habitat microbiome shifts and space radiation require vigilant skin barrier care and lymphocyte surveillance.`,
      plainLanguageExplanation:
        'Spaceflight stress and closed-cabin humidity can make skin more sensitive while mildly suppressing immune cells. Inspect skin contact zones from spacesuit or harness straps regularly.',
      earthConsultUrgency: triageStatus === 'green' ? 'routine_downlink' : 'priority_packet',
      guidedSteps: [
        {
          id: 'imm-def-1',
          stepNumber: 1,
          title: 'Dermal Barrier & Bio-Harness Contact Inspection',
          plainInstruction:
            'Inspect forearms, neck seal, and torso sensor sites for closed-cabin contact dermatitis or erythema; upload image if rash is present.',
          hardwareRequired: 'Crew Tablet Camera / Dermascope',
          estimatedMinutes: 5,
        },
        {
          id: 'imm-def-2',
          stepNumber: 2,
          title: 'Sync Personal Active Dosimeter & HEPA Filter Differential',
          plainInstruction:
            'Verify cumulative mission dose against ALARA limits and confirm cabin microbial HEPA filter pressure drop is nominal.',
          hardwareRequired: 'Crew Personal Dosimeter (CPD)',
          estimatedMinutes: 4,
        },
      ],
    },
    behavioral: {
      headline:
        triageStatus === 'green'
          ? 'Circadian Alignment & Cognitive Readiness Optimal'
          : 'Circadian / Vigilance Drift — Blue-Light & Sleep Hygiene Protocol',
      hazardContextSummary: `${envContextMap[environment]} Absence of natural 24h Earth dawn/dusk cues and high operational tempo risk circadian phase drift and reaction-time lapses.`,
      plainLanguageExplanation:
        'Consistent sleep quality and sharp reaction times are critical before any EVA or docking task. Use tunable habitat lighting and acoustic shielding to protect deep sleep.',
      earthConsultUrgency: triageStatus === 'green' ? 'routine_downlink' : 'priority_packet',
      guidedSteps: [
        {
          id: 'beh-def-1',
          stepNumber: 1,
          title: 'Switch Crew Quarters SLA Lighting to 480nm Depleted Evening Mode',
          plainInstruction:
            'Engage warm circadian lighting (<3000K) 90 minutes before scheduled sleep to support endogenous melatonin onset.',
          hardwareRequired: 'Solid-State Lighting Assembly (SSLA)',
          estimatedMinutes: 3,
        },
        {
          id: 'beh-def-2',
          stepNumber: 2,
          title: 'Complete 3-Minute Psychomotor Vigilance Task (PVT)',
          plainInstruction:
            'Run morning reaction-time test on tablet and log subjective sleep restorative rating.',
          hardwareRequired: 'ARGUS Crew Tablet',
          estimatedMinutes: 4,
        },
      ],
    },
  };

  const base = defaultByZone[zoneId];
  return {
    zoneId,
    environment,
    scenarioId,
    triageStatus,
    ...base,
    source: 'offline_verified_cache',
  };
}

/**
 * 1-Click Sample Medical Diagnostic Images for Visual Self-Exam Input
 * (specs/02-ui-dashboard.md: Nominal Retina, SANS Optic Nerve Ultrasound, Closed-Cabin Skin Rash)
 */
const NOMINAL_RETINA_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220">
  <rect width="320" height="220" fill="#060b16"/>
  <circle cx="160" cy="110" r="88" fill="#5b1d16" stroke="#22c55e" stroke-width="2"/>
  <circle cx="160" cy="110" r="78" fill="#7c2419" opacity="0.85"/>
  <!-- Crisp optic disc -->
  <circle cx="132" cy="108" r="18" fill="#fcd34d" opacity="0.92" stroke="#fde68a" stroke-width="2"/>
  <!-- Macula -->
  <circle cx="188" cy="112" r="14" fill="#450a0a" opacity="0.55"/>
  <!-- Retinal vessels -->
  <path d="M132 108 Q155 75 215 62" stroke="#991b1b" stroke-width="3" fill="none"/>
  <path d="M132 108 Q160 142 220 156" stroke="#991b1b" stroke-width="3" fill="none"/>
  <path d="M132 108 Q110 72 86 58" stroke="#b91c1c" stroke-width="2.2" fill="none"/>
  <path d="M132 108 Q108 145 84 162" stroke="#b91c1c" stroke-width="2.2" fill="none"/>
  <text x="12" y="22" fill="#22c55e" font-family="monospace" font-size="10">FUNDOSCOPY // OD NOMINAL</text>
  <text x="12" y="206" fill="#94a3b8" font-family="monospace" font-size="9">Sharp Disc Margins • Cup/Disc 0.3 • No Edema</text>
</svg>
`)}`;

const SANS_ULTRASOUND_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220">
  <rect width="320" height="220" fill="#040812"/>
  <!-- B-Mode Ultrasound Sector -->
  <path d="M40 20 L280 20 L300 200 L20 200 Z" fill="#0f172a" stroke="#334155" stroke-width="1"/>
  <!-- Anechoic Vitreous Globe -->
  <ellipse cx="160" cy="78" rx="68" ry="48" fill="#020617" stroke="#64748b" stroke-width="3"/>
  <!-- Posterior Globe Flattening & Papilledema Bulge -->
  <path d="M128 122 Q160 112 192 122" stroke="#eab308" stroke-width="3" fill="none"/>
  <!-- Distended Optic Nerve Sheath (Hypoechoic column) -->
  <path d="M134 124 L126 196 L194 196 L186 124 Z" fill="#1e293b" stroke="#475569" stroke-width="1.5"/>
  <!-- Caliper Measurement 3mm posterior to retina -->
  <line x1="160" y1="124" x2="160" y2="148" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3"/>
  <line x1="130" y1="148" x2="190" y2="148" stroke="#ef4444" stroke-width="2.5"/>
  <circle cx="130" cy="148" r="3.5" fill="#ef4444"/>
  <circle cx="190" cy="148" r="3.5" fill="#ef4444"/>
  <text x="196" y="152" fill="#ef4444" font-family="monospace" font-weight="bold" font-size="11">ONSD: 6.42 mm</text>
  <text x="12" y="18" fill="#ef4444" font-family="monospace" font-size="10">OCULAR B-SCAN // SANS GRADE II</text>
  <text x="12" y="212" fill="#f87171" font-family="monospace" font-size="9">ALERT: Sheath &gt; 6.0mm + Posterior Globe Flattening</text>
</svg>
`)}`;

const CABIN_RASH_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220">
  <rect width="320" height="220" fill="#090d16"/>
  <!-- Dermascope circular viewport -->
  <circle cx="160" cy="110" r="84" fill="#d6a78a" stroke="#eab308" stroke-width="2"/>
  <!-- Erythematous maculopapular patch -->
  <ellipse cx="158" cy="112" rx="48" ry="34" fill="#dc2626" opacity="0.45"/>
  <circle cx="142" cy="104" r="6" fill="#b91c1c" opacity="0.7"/>
  <circle cx="168" cy="118" r="7" fill="#b91c1c" opacity="0.65"/>
  <circle cx="175" cy="98" r="5" fill="#b91c1c" opacity="0.7"/>
  <circle cx="148" cy="124" r="5.5" fill="#b91c1c" opacity="0.65"/>
  <circle cx="132" cy="115" r="4" fill="#b91c1c" opacity="0.6"/>
  <!-- Dermascope reticle -->
  <line x1="120" y1="110" x2="200" y2="110" stroke="#0f172a" stroke-width="0.8" opacity="0.5"/>
  <line x1="160" y1="70" x2="160" y2="150" stroke="#0f172a" stroke-width="0.8" opacity="0.5"/>
  <text x="12" y="20" fill="#eab308" font-family="monospace" font-size="10">DERMASCOPE // FOREARM SEAL ZONE</text>
  <text x="12" y="208" fill="#fde047" font-family="monospace" font-size="9">CAUTION: Closed-Cabin Contact Dermatitis (3.2 cm)</text>
</svg>
`)}`;

export const VISUAL_EXAM_SAMPLES: VisualExamSample[] = [
  {
    id: 'nominal_retina',
    title: 'Nominal Retina',
    zoneId: 'neuro',
    modality: 'Non-Mydriatic Retinal Fundoscopy',
    previewSvgDataUrl: NOMINAL_RETINA_SVG,
    defaultFindingStatus: 'green',
    clinicalSummary:
      'Sharp optic disc margins (Cup-to-Disc ratio 0.3), normal retinal arteriolar/venular caliber ratio, and absence of choroidal folds or optic disc edema.',
    plainCrewGuidance:
      'Your retinal scan looks completely healthy. There is no swelling around the optic nerve head and no folds in the back of the eye.',
    recommendedAction:
      'Log baseline retinal image to monthly medical archive; continue standard countermeasure schedule.',
  },
  {
    id: 'sans_ultrasound',
    title: 'SANS Optic Nerve Ultrasound',
    zoneId: 'neuro',
    modality: 'Ocular B-Mode Ultrasound (10 MHz)',
    previewSvgDataUrl: SANS_ULTRASOUND_SVG,
    defaultFindingStatus: 'red',
    clinicalSummary:
      'Optic Nerve Sheath Diameter (ONSD) measured 3 mm posterior to globe is 6.42 mm (critical threshold > 5.9 mm) with visible posterior scleral flattening and anterior optic nerve head protrusion.',
    plainCrewGuidance:
      'The ultrasound shows fluid expansion inside the protective sheath behind your eye (6.42 mm), a classic sign of Spaceflight-Associated Neuro-ocular Syndrome (SANS).',
    recommendedAction:
      'Initiate 45-min Lower Body Negative Pressure (LBNP) session at -25 mmHg, verify sleeping-bunk airflow to prevent CO₂ pockets, and queue this ultrasound packet for Earth Flight Surgeon review.',
  },
  {
    id: 'cabin_rash',
    title: 'Closed-Cabin Skin Rash',
    zoneId: 'immune',
    modality: 'Polarized Epiluminescence Dermascopy',
    previewSvgDataUrl: CABIN_RASH_SVG,
    defaultFindingStatus: 'yellow',
    clinicalSummary:
      'Well-demarcated 3.2 cm erythematous maculopapular plaque on volar forearm without vesiculation, purulence, or systemic lymphadenopathy — consistent with spaceflight irritant/microbiome dermatitis.',
    plainCrewGuidance:
      'Mild localized skin inflammation common in low-humidity closed spacecraft cabins where sweat and suit cuffs rub against the skin barrier.',
    recommendedAction:
      'Cleanse gently with no-rinse chlorhexidine wipe, apply topical 1% hydrocortisone cream twice daily for 5 days, and re-image in 48 hours.',
  },
];
