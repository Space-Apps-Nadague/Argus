/**
 * zod schemas: request validation (untrusted client input) and LLM output validation
 * (untrusted model output). Shapes mirror `src/types/aiApi.ts`.
 */

import { z } from 'zod';

const text = (max = 2000) => z.string().max(max);
const num = () => z.coerce.number().refine(Number.isFinite, 'must be a finite number');

export const ScenarioIdSchema = z.enum(['nominal', 'sans_alert', 'high_co2', 'solar_storm']);
export const ZoneIdSchema = z.enum(['neuro', 'cardio', 'musculo', 'immune', 'behavioral']);
export const EnvironmentSchema = z.enum(['0g_transit', 'iss_leo', 'lunar_base', 'mars_base', 'earth_1g']);
export const TriageStatusSchema = z.enum(['green', 'yellow', 'red']);
export const UrgencySchema = z.enum(['routine_downlink', 'priority_packet', 'immediate_emergency_packet']);

export const CrewMemberSchema = z.object({
  id: text(100),
  name: text(120),
  callsign: text(60),
  role: text(120),
  sex: z.enum(['female', 'male']),
  age: z.number().min(18).max(90),
  bloodType: z.enum(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']),
  restingHrBaselineBpm: z.number().min(30).max(120),
  preFlightOnsdMm: z.number().min(3).max(8),
  missionDaysLogged: z.number().min(0).max(5000),
  countermeasureStreakSols: z.number().min(0).max(5000),
  defaultScenarioId: ScenarioIdSchema,
  medicalNotes: text(2000),
  isCustom: z.boolean().optional(),
});

export const LocationIdSchema = z.enum([
  'earth_pre',
  'earth_post',
  'leo',
  'gateway',
  'lunar_surface',
  'mars_transit',
  'mars_surface',
  'rover',
]);

export const CheckInEntrySchema = z.object({
  id: text(100),
  crewId: text(100),
  missionDay: z.number().int().min(1).max(5000),
  timestampIso: text(40),
  values: z.record(z.string(), num()),
  note: text(1000).optional(),
  scenarioId: ScenarioIdSchema.optional(),
});

export const CrewContextSchema = z.object({
  crewMember: CrewMemberSchema.optional(),
  scenarioId: ScenarioIdSchema,
  environment: EnvironmentSchema.optional(),
  locationId: LocationIdSchema.optional(),
  telemetryCheckIns: z.array(CheckInEntrySchema).max(200).optional(),
});

export const GuidanceRequestSchema = CrewContextSchema.extend({
  zoneId: ZoneIdSchema,
  crewSymptoms: text(2000).optional(),
});

export const VisionRequestSchema = z
  .object({
    sampleId: z.enum(['nominal_retina', 'sans_ultrasound', 'cabin_rash']).optional(),
    uploadedFile: z
      .object({
        fileName: text(200),
        base64Data: z.string().max(14_000_000), // ~10 MB image
        mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
      })
      .optional(),
    environment: EnvironmentSchema.optional(),
  })
  .refine((v) => v.sampleId || v.uploadedFile, 'sampleId or uploadedFile is required');

const scale = () => z.number().int().min(1).max(5);

export const WellbeingCheckInSchema = z.object({
  id: text(100),
  crewId: text(100),
  missionDay: z.number().int().min(0).max(5000),
  timestampIso: text(40),
  mood: scale(),
  stress: scale(),
  energy: scale(),
  sleepQuality: scale(),
  cohesion: scale(),
  motivation: scale(),
  note: text(1000).optional(),
});

export const WellbeingRequestSchema = CrewContextSchema.extend({
  checkIns: z.array(WellbeingCheckInSchema).max(60),
});

export const ChatRequestSchema = CrewContextSchema.extend({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: text(4000), timestampIso: text(40).optional() }))
    .min(1)
    .max(40),
  checkIns: z.array(WellbeingCheckInSchema).max(60).optional(),
});

export const VoiceTransportModeSchema = z.enum(['live-api', 'on-ship-pipeline']);

export const LiveTokenRequestSchema = CrewContextSchema.extend({
  forceOffline: z.boolean().optional(),
  enableVideo: z.boolean().optional(),
});

export const VoiceSttRequestSchema = CrewContextSchema.extend({
  audioBase64: z.string().max(14_000_000).optional(),
  mimeType: text(120).optional(),
  fallbackTranscript: text(4000).optional(),
  mode: VoiceTransportModeSchema.optional(),
  languageCode: text(40).optional(),
});

export const VoiceTtsRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  voice: text(80).optional(),
  style: text(200).optional(),
  mode: VoiceTransportModeSchema.optional(),
});

export const VoiceToolCallRequestSchema = CrewContextSchema.extend({
  toolName: z.enum(['get_crew_snapshot', 'log_checkin_reading', 'lookup_medical_protocol']),
  callId: text(120).optional(),
  args: z
    .object({
      zoneId: ZoneIdSchema.optional(),
      metricId: text(80).optional(),
      value: num().optional(),
      note: text(1000).optional(),
      query: text(1000).optional(),
    })
    .optional(),
});

export const VoiceTurnRequestSchema = CrewContextSchema.extend({
  transcript: text(4000),
  existingReplyText: text(6000).optional(),
  audioBase64: z.string().max(14_000_000).optional(),
  audioMimeType: text(120).optional(),
  imageBase64: z.string().max(14_000_000).optional(),
  imageMimeType: text(120).optional(),
  mode: VoiceTransportModeSchema.optional(),
  synthesizeAudio: z.boolean().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: text(4000), timestampIso: text(40).optional() }))
    .max(20)
    .optional(),
});

// ── LLM output schemas ───────────────────────────────────────────────────────

export const GuidanceLlmSchema = z.object({
  headline: text(200),
  hazardContextSummary: text(1200),
  plainLanguageExplanation: text(2000),
  earthConsultUrgency: UrgencySchema,
  guidedSteps: z
    .array(
      z.object({
        id: z.string().optional(),
        stepNumber: num().optional(),
        title: text(160),
        plainInstruction: text(800),
        hardwareRequired: text(200).default('None'),
        estimatedMinutes: num().default(5),
      })
    )
    .min(1)
    .max(8),
});

export const VisionLlmSchema = z.object({
  findingStatus: TriageStatusSchema,
  clinicalSummary: text(1200),
  plainCrewGuidance: text(1200),
  recommendedAction: text(600),
});

export const DiagnosticsLlmSchema = z.object({
  summary: text(1200),
  earthConsultUrgency: UrgencySchema,
  hypotheses: z
    .array(
      z.object({
        condition: text(160),
        hrpRisk: text(200),
        likelihood: z.enum(['low', 'moderate', 'high']),
        confidence: num().transform((v) => Math.max(0, Math.min(1, v > 1 ? v / 100 : v))),
        supportingMetricIds: z.array(z.string()).max(12),
        rationale: text(800),
        suggestedConfirmation: text(400),
      })
    )
    .max(6),
});

export const RecommendationsLlmSchema = z.object({
  headline: text(200),
  recommendations: z
    .array(
      z.object({
        category: z.enum(['exercise', 'sleep', 'nutrition', 'radiation', 'environment', 'behavioral', 'medical_check']),
        title: text(160),
        plainInstruction: text(800),
        rationale: text(500),
        targetMetricIds: z.array(z.string()).max(12),
        priority: z.enum(['now', 'today', 'this_week']),
        durationMinutes: num(),
      })
    )
    .min(1)
    .max(8),
});

export const WellbeingLlmSchema = z.object({
  supportiveMessage: text(1200),
  suggestedActions: z.array(text(200)).min(1).max(5),
});
