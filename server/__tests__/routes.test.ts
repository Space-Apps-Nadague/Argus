/**
 * Endpoint tests with no provider configured: every route must answer with its deterministic
 * offline result (no network calls are made).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type {
  AiProviderStatus,
  DiagnosticsResponse,
  GuidanceResponse,
  RecommendationsResponse,
  WellbeingResponse,
} from '../../src/types/aiApi';
import { DEFAULT_CREW_ROSTER } from '../../src/data/telemetryScenarios';
import { METRIC_IDS } from '../../src/utils/triageEngine';
import { createApp } from '../app';
import { demoCheckIns } from '../models/wellbeingModel';

const AI_ENV_PREFIXES = ['AI_', 'OPENROUTER_', 'GEMINI_', 'GROQ_'];

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (AI_ENV_PREFIXES.some((p) => key.startsWith(p))) delete process.env[key];
  }
});

const app = createApp();
const crewMember = DEFAULT_CREW_ROSTER[0];

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('AI routes (offline)', () => {
  it('GET /api/health reports no providers', async () => {
    const res = await app.request('/api/health');
    const body = (await res.json()) as AiProviderStatus;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ aiAvailable: false, chain: [] });
  });

  it('rejects invalid bodies with 400', async () => {
    const res = await post('/api/ai/guidance', { scenarioId: 'not_a_scenario' });
    expect(res.status).toBe(400);
  });

  it('POST /api/ai/guidance returns offline guidance with the deterministic status', async () => {
    const res = await post('/api/ai/guidance', { scenarioId: 'sans_alert', zoneId: 'neuro', crewMember });
    const body = (await res.json()) as GuidanceResponse;
    expect(body.meta.source).toBe('offline_verified_cache');
    expect(body.result).toMatchObject({ zoneId: 'neuro', triageStatus: 'red' });
  });

  it('POST /api/ai/guidance incorporates crewSymptoms in offline fallback', async () => {
    const res = await post('/api/ai/guidance', {
      scenarioId: 'nominal',
      zoneId: 'cardio',
      crewMember,
      crewSymptoms: 'Throbbing headache behind eyes, blurred near vision, optic disc swelling',
    });
    const body = (await res.json()) as GuidanceResponse;
    expect(body.meta.source).toBe('offline_verified_cache');
    expect(body.result.headline).toContain('Neuro-Ocular & SANS Assessment');
    expect(body.result.zoneId).toBe('neuro');
    expect(body.result.guidedSteps.length).toBeGreaterThan(0);
  });

  it('POST /api/ai/vision returns the reference sample finding', async () => {
    const res = await post('/api/ai/vision', { sampleId: 'sans_ultrasound' });
    const body = await res.json();
    expect(body.meta.source).toBe('offline_verified_cache');
    expect(body.result.findingStatus).toBeDefined();
  });

  it('POST /api/ai/diagnostics returns trends, rule hypotheses and an urgency floor', async () => {
    const res = await post('/api/ai/diagnostics', { scenarioId: 'sans_alert', crewMember });
    const body = (await res.json()) as DiagnosticsResponse;
    expect(body.meta.source).toBe('offline_verified_cache');
    expect(body.result.trends.length).toBe(METRIC_IDS.length); // 17 incl. the challenge core indicators
    expect(body.result.hypotheses[0].id).toBe('sans');
    expect(body.result.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(body.result.disclaimer).toMatch(/not a diagnosis/i);
  });

  it('POST /api/ai/diagnostics applies telemetryCheckIns before triage and trends', async () => {
    const res = await post('/api/ai/diagnostics', {
      scenarioId: 'nominal',
      crewMember,
      telemetryCheckIns: [
        {
          id: 'ci-route-1',
          crewId: crewMember.id,
          missionDay: 30,
          timestampIso: '2026-11-14T10:00:00.000Z',
          values: { onsd: 6.4 },
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiagnosticsResponse;
    expect(body.result.zoneStatuses.neuro).toBe('red');
    expect(body.result.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(body.result.trends.find((t) => t.metricId === 'onsd')?.currentValue).toBe(6.4);
  });

  it('POST /api/ai/recommendations returns a library plan', async () => {
    const res = await post('/api/ai/recommendations', { scenarioId: 'high_co2', crewMember });
    const body = (await res.json()) as RecommendationsResponse;
    expect(body.result.recommendations.some((r) => r.targetMetricIds.includes('cabin_co2'))).toBe(true);
  });

  it('POST /api/ai/wellbeing escalates crisis language', async () => {
    const checkIns = demoCheckIns(crewMember.id);
    checkIns[checkIns.length - 1].note = 'I have been thinking about ending my life';
    const res = await post('/api/ai/wellbeing', { scenarioId: 'nominal', crewMember, checkIns });
    const body = (await res.json()) as WellbeingResponse;
    expect(body.result).toMatchObject({ crisisFlag: true, status: 'red', earthConsultUrgency: 'immediate_emergency_packet' });
    expect(body.result.supportiveMessage).toMatch(/Crew Medical Officer/);
  });

  it('POST /api/ai/chat streams an offline reply over SSE', async () => {
    const res = await post('/api/ai/chat', {
      scenarioId: 'sans_alert',
      crewMember,
      messages: [{ role: 'user', content: 'My eyes feel weird, is my vision ok?' }],
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));
    expect(events[0]).toMatchObject({ type: 'meta', crisis: false, meta: { source: 'offline_verified_cache' } });
    const reply = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(reply).toMatch(/Neuro/i);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('POST /api/ai/chat leads with the fixed escalation on crisis language', async () => {
    const res = await post('/api/ai/chat', {
      scenarioId: 'nominal',
      crewMember,
      messages: [{ role: 'user', content: 'I want to hurt myself' }],
    });
    const events = (await res.text())
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5)));
    expect(events[0]).toMatchObject({ type: 'meta', crisis: true, earthConsultUrgency: 'immediate_emergency_packet' });
    expect(events[1].text).toMatch(/Crew Medical Officer/);
  });

  it('allows same-origin POST behind TLS-terminating proxy and blocks cross-origin POST', async () => {
    const sameOrigin = await app.request('http://argus-space.azurewebsites.net/api/ai/guidance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://argus-space.azurewebsites.net',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'argus-space.azurewebsites.net',
      },
      body: JSON.stringify({ scenarioId: 'nominal', zoneId: 'neuro', crewMember }),
    });
    expect(sameOrigin.status).toBe(200);

    const crossOrigin = await app.request('http://argus-space.azurewebsites.net/api/ai/guidance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'argus-space.azurewebsites.net',
      },
      body: JSON.stringify({ scenarioId: 'nominal', zoneId: 'neuro', crewMember }),
    });
    expect(crossOrigin.status).toBe(403);
  });

  it('returns 404 JSON for unknown /api/* routes', async () => {
    const res = await app.request('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
