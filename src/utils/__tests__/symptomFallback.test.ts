/**
 * Unit tests for deterministic offline crew symptom & clinical Q&A keyword fallback engine
 * Single Source of Truth: specs/01-data-schema.md (§4), specs/02-ui-dashboard.md (§2.4)
 */

import { describe, expect, it } from 'vitest';
import { matchOfflineSymptomGuidance } from '../symptomFallback';
import { getOfflineFlightSurgeonGuidance, DEFAULT_CREW_ROSTER } from '../../data/telemetryScenarios';
import { synthesizeFlightSurgeonGuidance } from '../../services/flightSurgeonAi';

const testCrew = DEFAULT_CREW_ROSTER[0];

describe('matchOfflineSymptomGuidance', () => {
  it('returns null for empty or whitespace-only symptoms', () => {
    expect(matchOfflineSymptomGuidance({ symptoms: '' })).toBeNull();
    expect(matchOfflineSymptomGuidance({ symptoms: '   \n\t  ' })).toBeNull();
  });

  it('detects SANS & neuro-ocular keywords and returns targeted guidance', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Throbbing headache behind my eyes and blurred near vision when reading checklists',
      scenarioId: 'nominal',
      fallbackZoneId: 'cardio',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('neuro');
    expect(res?.triageStatus).toBe('yellow');
    expect(res?.earthConsultUrgency).toBe('priority_packet');
    expect(res?.headline).toContain('Neuro-Ocular & SANS Assessment');
    expect(res?.plainLanguageExplanation).toContain('cranial venous pooling');
    expect(res?.guidedSteps.some((s) => s.title.includes('Ultrasound'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('LBNP'))).toBe(true);
  });

  it('detects hypercapnia & cabin CO2 scrubber degradation symptoms', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Cabin air feels stuffy, severe headache and air hunger with carbon dioxide scrubber alert',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('neuro');
    expect(res?.triageStatus).toBe('red');
    expect(res?.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(res?.headline).toContain('Hypercapnia & Cabin Air Quality Alert');
    expect(res?.guidedSteps.some((s) => s.title.includes('LiOH') || s.title.includes('CDRA'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('O₂ Mask'))).toBe(true);
  });

  it('detects cardiovascular symptoms and generates autonomic protocols', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Experiencing rapid heart palpitations and dizziness when unstrapping from workstation',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('cardio');
    expect(res?.triageStatus).toBe('yellow');
    expect(res?.earthConsultUrgency).toBe('priority_packet');
    expect(res?.headline).toContain('Cardiovascular & Autonomic Symptoms');
    expect(res?.guidedSteps.some((s) => s.title.includes('ECG'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('Hydration'))).toBe(true);
  });

  it('detects musculoskeletal spinal lengthening and lumbar strain symptoms', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Persistent lower back pain and spinal lengthening stiffness after sleeping in tether',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('musculo');
    expect(res?.triageStatus).toBe('yellow');
    expect(res?.headline).toContain('Musculoskeletal & Spinal Protocol');
    expect(res?.guidedSteps.some((s) => s.title.includes('ARED'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('Mobilization') || s.title.includes('Fetal'))).toBe(true);
  });

  it('detects immune, dermal rash, and radiation exposure symptoms', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Itchy erythematous rash on forearms and dosimeter alarm sounding in hab',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('immune');
    expect(res?.triageStatus).toBe('red');
    expect(res?.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(res?.headline).toContain('Immune & Radiation Dosimetry Protocol');
    expect(res?.guidedSteps.some((s) => s.title.includes('Dermal') || s.title.includes('Dosimeter'))).toBe(true);
  });

  it('detects behavioral, circadian, and sleep loss symptoms', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Suffering from severe insomnia, poor sleep efficiency, and morning cognitive brain fog',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.zoneId).toBe('behavioral');
    expect(res?.triageStatus).toBe('yellow');
    expect(res?.headline).toContain('Circadian Alignment & Vigilance Protocol');
    expect(res?.guidedSteps.some((s) => s.title.includes('Lighting'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('Psychomotor') || s.title.includes('PVT'))).toBe(true);
  });

  it('escalates acute red-flag symptoms to red triage status and immediate emergency consult', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'Astronaut reporting crushing chest pain and difficulty breathing',
      scenarioId: 'nominal',
    });
    expect(res).not.toBeNull();
    expect(res?.triageStatus).toBe('red');
    expect(res?.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(res?.headline).toContain('CRITICAL MEDICAL EMERGENCY');
    expect(res?.guidedSteps.some((s) => s.title.includes('Alert'))).toBe(true);
    expect(res?.guidedSteps.some((s) => s.title.includes('O₂'))).toBe(true);
  });

  it('handles general clinical queries by logging query and generating structured steps', () => {
    const res = matchOfflineSymptomGuidance({
      symptoms: 'What is our expected protocol if communication blackout extends past 30 minutes?',
      scenarioId: 'nominal',
      fallbackZoneId: 'neuro',
    });
    expect(res).not.toBeNull();
    expect(res?.headline).toContain('Autonomous Clinical Guidance: Crew Query Recorded');
    expect(res?.plainLanguageExplanation).toContain('What is our expected protocol');
    expect(res?.guidedSteps.length).toBe(3);
    expect(res?.source).toBe('offline_verified_cache');
  });
});

describe('getOfflineFlightSurgeonGuidance integration with crewSymptoms', () => {
  it('returns standard scenario guidance when crewSymptoms is omitted or empty', () => {
    const nominal = getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit', testCrew);
    expect(nominal.headline).toContain('Neuro-Ocular Baseline Stable');

    const emptySymptoms = getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit', testCrew, '   ');
    expect(emptySymptoms.headline).toContain('Neuro-Ocular Baseline Stable');
  });

  it('returns symptom-matched guidance when crewSymptoms is provided', () => {
    const withSymptoms = getOfflineFlightSurgeonGuidance(
      'nominal',
      'cardio',
      '0g_transit',
      testCrew,
      'Severe headache behind eyes, blurry vision, optic disc swelling'
    );
    expect(withSymptoms.headline).toContain('Neuro-Ocular & SANS Assessment');
    expect(withSymptoms.zoneId).toBe('neuro');
    expect(withSymptoms.source).toBe('offline_verified_cache');
  });
});

describe('synthesizeFlightSurgeonGuidance offline fallback with crewSymptoms', () => {
  it('returns deterministic symptom guidance when forceLiveAi is false', async () => {
    const res = await synthesizeFlightSurgeonGuidance({
      scenarioId: 'nominal',
      zoneId: 'musculo',
      environment: '0g_transit',
      crewMember: testCrew,
      forceLiveAi: false,
      crewSymptoms: 'Severe lumbar back pain and spine lengthening discomfort',
    });
    expect(res.source).toBe('offline_verified_cache');
    expect(res.headline).toContain('Musculoskeletal & Spinal Protocol');
    expect(res.zoneId).toBe('musculo');
  });
});
