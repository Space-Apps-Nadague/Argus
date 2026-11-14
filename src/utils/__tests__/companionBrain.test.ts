import { describe, expect, it } from 'vitest';
import {
  determineCompanionIntent,
  generateOfflineCompanionReply,
  CompanionBrainContext,
} from '../companionBrain';
import { DEFAULT_CREW_ROSTER, TELEMETRY_SCENARIOS } from '../../data/telemetryScenarios';
import { evaluateAllZones } from '../triageEngine';

const mockCrew = DEFAULT_CREW_ROSTER[0];
const nominalScenario = TELEMETRY_SCENARIOS.nominal;
const nominalZones = nominalScenario.zones;
const nominalStatuses = evaluateAllZones(nominalZones, '0g_transit');

const createContext = (overrides?: Partial<CompanionBrainContext>): CompanionBrainContext => ({
  crewMember: mockCrew,
  environment: '0g_transit',
  scenarioId: 'nominal',
  readinessScore: 92,
  zoneStatuses: nominalStatuses,
  zones: nominalZones,
  streakDays: 14,
  ...overrides,
});

describe('companionBrain intent classifier (determineCompanionIntent)', () => {
  it('identifies critical medical red flags in English', () => {
    expect(determineCompanionIntent('I have acute crushing chest pain')).toBe('red_flag');
    expect(determineCompanionIntent("Help, I can't breathe")).toBe('red_flag');
    expect(determineCompanionIntent('Experiencing severe shortness of breath')).toBe('red_flag');
    expect(determineCompanionIntent('Astronaut passed out in airlock')).toBe('red_flag');
    expect(determineCompanionIntent('Crew member had a seizure')).toBe('red_flag');
    expect(determineCompanionIntent('Feeling faint and dizzy')).toBe('red_flag');
    expect(determineCompanionIntent('Sudden blindness in right eye')).toBe('red_flag');
  });

  it('identifies mental health crisis / self-harm flags in English and Hebrew', () => {
    expect(determineCompanionIntent('I feel like hurting myself')).toBe('red_flag');
    expect(determineCompanionIntent('Having thoughts of suicide')).toBe('red_flag');
    expect(determineCompanionIntent('I want to die')).toBe('red_flag');
    expect(determineCompanionIntent('אני מרגיש שאני רוצה לפגוע בעצמי')).toBe('red_flag');
    expect(determineCompanionIntent('יש לי מחשבות אובדניות')).toBe('red_flag');
  });

  it('identifies Hebrew medical emergency keywords as red flags', () => {
    expect(determineCompanionIntent('יש לי כאב חזק בחזה')).toBe('red_flag');
    expect(determineCompanionIntent('קשה לי לנשום כאן')).toBe('red_flag');
    expect(determineCompanionIntent('התעלפתי הבוקר')).toBe('red_flag');
    expect(determineCompanionIntent('קוצר נשימה חריף')).toBe('red_flag');
  });

  it('identifies forecast and trend queries', () => {
    expect(determineCompanionIntent('Forecast my readiness for tomorrow')).toBe('forecast');
    expect(determineCompanionIntent('What is my 72h trend projection?')).toBe('forecast');
    expect(determineCompanionIntent('Will I be nominal in the next 48 hours?')).toBe('forecast');
    expect(determineCompanionIntent('תחזית ליומיים הקרובים')).toBe('forecast');
  });

  it('identifies "why" and physiological association queries', () => {
    expect(determineCompanionIntent('Why is my HRV low?')).toBe('why');
    expect(determineCompanionIntent('What is the link between CO2 and ONSD?')).toBe('why');
    expect(determineCompanionIntent('Explain the pattern in my sleep and alertness')).toBe('why');
    expect(determineCompanionIntent('למה הדופק שלי גבוה')).toBe('why');
  });

  it('identifies radiation queries', () => {
    expect(determineCompanionIntent('What is my radiation dose today?')).toBe('radiation');
    expect(determineCompanionIntent('Is the dosimeter reading high?')).toBe('radiation');
    expect(determineCompanionIntent('Should we shelter from the solar storm?')).toBe('radiation');
    expect(determineCompanionIntent('מה רמת הקרינה')).toBe('radiation');
  });

  it('identifies specific vital metric inquiries', () => {
    expect(determineCompanionIntent('What is my ONSD right now?')).toBe('metric');
    expect(determineCompanionIntent('Show me my cabin CO2 reading')).toBe('metric');
    expect(determineCompanionIntent('Check my resting heart rate')).toBe('metric');
    expect(determineCompanionIntent('What is my SpO2 level?')).toBe('metric');
    expect(determineCompanionIntent('Tell me about my bone mineral density (BMD)')).toBe('metric');
    expect(determineCompanionIntent('What is my ARED load?')).toBe('metric');
    expect(determineCompanionIntent('How are my PVT lapses looking?')).toBe('metric');
  });

  it('identifies spaceflight symptom complaints', () => {
    expect(determineCompanionIntent('I have a pounding headache')).toBe('symptom');
    expect(determineCompanionIntent('Experiencing blurred vision while reading manuals')).toBe('symptom');
    expect(determineCompanionIntent('My lower back pain is acting up')).toBe('symptom');
    expect(determineCompanionIntent('Feeling dizzy and nauseous after rotation')).toBe('symptom');
    expect(determineCompanionIntent('I am utterly exhausted and fatigued')).toBe('symptom');
    expect(determineCompanionIntent('Having trouble sleeping in my berth')).toBe('symptom');
    expect(determineCompanionIntent('Noticed an itchy rash on my forearm')).toBe('symptom');
  });

  it('identifies status, readiness, and greeting queries', () => {
    expect(determineCompanionIntent('How am I doing?')).toBe('status');
    expect(determineCompanionIntent('Give me an overview of my vitals')).toBe('status');
    expect(determineCompanionIntent('Status report')).toBe('status');
    expect(determineCompanionIntent('Check me')).toBe('status');
    expect(determineCompanionIntent('Hello ARGUS')).toBe('status');
    expect(determineCompanionIntent('Good morning')).toBe('status');
    expect(determineCompanionIntent('מה שלומי היום')).toBe('status');
  });

  it('identifies help queries', () => {
    expect(determineCompanionIntent('Help')).toBe('help');
    expect(determineCompanionIntent('What can you do?')).toBe('help');
    expect(determineCompanionIntent('Who are you?')).toBe('help');
    expect(determineCompanionIntent('עזרה')).toBe('help');
  });

  it('falls back gracefully on unknown inputs', () => {
    expect(determineCompanionIntent('abracadabra 12345')).toBe('fallback');
    expect(determineCompanionIntent('potatoes and carrots')).toBe('fallback');
  });
});

describe('generateOfflineCompanionReply responses and guardrails', () => {
  it('handles red flags with emergency protocol and urgency escalation', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('I have crushing chest pain and shortness of breath', ctx);

    expect(result.intent).toBe('red_flag');
    expect(result.urgencyEscalation).toBe('immediate_emergency_packet');
    expect(result.source).toBe('offline_brain');
    expect(result.text).toContain('CRITICAL ALERT');
    expect(result.text).toContain('Stop all physical exertion immediately');
    expect(result.text).toContain('Alert your nearest crewmate');
    expect(result.text).toContain('Emergency Telemetry Packet');
    expect(result.text).toContain(mockCrew.callsign);
  });

  it('handles mental health crisis with compassionate protocol', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('I feel like hurting myself', ctx);

    expect(result.intent).toBe('red_flag');
    expect(result.urgencyEscalation).toBe('immediate_emergency_packet');
    expect(result.text).toContain('Crew Medical Officer');
    expect(result.text).toContain('tele-mental health');
    expect(result.text).toContain('I am staying online with you right here');
  });

  it('generates status summary with readiness score and 5-zone breakdown', () => {
    const ctx = createContext({ readinessScore: 88 });
    const result = generateOfflineCompanionReply('How am I doing?', ctx);

    expect(result.intent).toBe('status');
    expect(result.source).toBe('offline_brain');
    expect(result.text).toContain('88%');
    expect(result.text).toContain('Neuro-Ocular');
    expect(result.text).toContain('Cardiovascular');
    expect(result.text).toContain('Musculoskeletal');
    expect(result.text).toContain('Immune');
    expect(result.text).toContain('Behavioral');
    expect(result.text).toContain('Earth Comm Delay');
  });

  it('generates specific vital metric response with baseline delta and NASA mechanism', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('Check my ONSD reading', ctx);

    expect(result.intent).toBe('metric');
    expect(result.text).toContain('Optic Nerve Sheath Diameter');
    expect(result.text).toContain('Cephalad fluid shift in microgravity elevates intracranial pressure');
    expect(result.text).toContain('ocular ultrasound');
  });

  it('generates symptom assessment with related biomarkers and countermeasures', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('I have a bad headache and my head feels full', ctx);

    expect(result.intent).toBe('symptom');
    expect(result.text).toContain('Headache & Cephalic Congestion');
    expect(result.text).toContain('Guided Countermeasures');
    expect(result.text).toContain('cabin CO₂ monitors');
  });

  it('generates forecast report with 24h, 48h, 72h horizon projections', () => {
    const ctx = createContext({ readinessScore: 78 });
    const result = generateOfflineCompanionReply('Forecast for next 72 hours', ctx);

    expect(result.intent).toBe('forecast');
    expect(result.text).toContain('72-Hour Longitudinal Trend Projection');
    expect(result.text).toContain('+24 Hours');
    expect(result.text).toContain('+48 Hours');
    expect(result.text).toContain('+72 Hours');
  });

  it('generates radiation report with dosimeter reading and shelter guidance', () => {
    const ctx = createContext({ scenarioId: 'solar_storm' });
    const result = generateOfflineCompanionReply('What is the radiation situation?', ctx);

    expect(result.intent).toBe('radiation');
    expect(result.text).toContain('Space Radiation & Dosimetry Report');
    expect(result.text).toContain('NASA HRP Radiation Context');
  });

  it('generates "why" report with candidate physiological links', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('Why is there a pattern between my sleep and reaction lapses?', ctx);

    expect(result.intent).toBe('why');
    expect(result.text).toContain('physiological associations');
  });

  it('generates help manual listing capabilities and disclaimers', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('Help me understand what you can do', ctx);

    expect(result.intent).toBe('help');
    expect(result.text).toContain('ARGUS Companion — Autonomous Crew Health Assistant');
    expect(result.text).toContain('How am I?');
    expect(result.text).toContain('Clinical Guardrail');
  });

  it('appends recognized Hebrew annotation when Hebrew keywords are present', () => {
    const ctx = createContext();
    const result = generateOfflineCompanionReply('מה שלומי היום?', ctx);

    expect(result.text).toContain('Recognized Hebrew terms; replies provided in English');
  });

  it('strictly adheres to guardrail: never mutates context and never lowers urgency', () => {
    const ctx = createContext({
      zoneStatuses: { ...nominalStatuses },
      readinessScore: 92,
    });
    const frozenCopy = JSON.parse(JSON.stringify(ctx));

    const result = generateOfflineCompanionReply('What can you tell me about the weather on Mars?', ctx);

    // Guardrail: Context is unmodified
    expect(ctx.readinessScore).toBe(frozenCopy.readinessScore);
    expect(ctx.zoneStatuses).toEqual(frozenCopy.zoneStatuses);

    // Guardrail: Urgency is not lowered (result does not force routine_downlink or downgrade anything)
    expect(result.urgencyEscalation).toBeUndefined();
  });
});
