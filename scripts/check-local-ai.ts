/**
 * `npm run ai:local` — checks that the local model server is up and AI_LOCAL_MODEL is available,
 * then sends one tiny test prompt.
 */

import OpenAI from 'openai';
import { loadEnv } from '../server/env';
import { buildProvider } from '../server/ai/providers';
import { localSpeechConfig, localSynthesize, localTranscribe, probeLocalSpeech } from '../server/ai/localSpeech';

loadEnv();

async function main() {
  const cfg = buildProvider('local', process.env);
  const baseUrl = process.env.AI_LOCAL_BASE_URL?.trim() || 'http://localhost:11434/v1';
  if (!cfg) {
    console.error('✗ AI_LOCAL_MODEL is not set. Add it to .env (e.g. AI_LOCAL_MODEL=qwen3:8b).');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: 'not-needed', baseURL: cfg.baseUrl, timeout: 5000, maxRetries: 0 });
  let models: string[];
  try {
    models = (await client.models.list()).data.map((m) => m.id);
  } catch {
    console.error(`✗ No local model server at ${baseUrl}.`);
    console.error('  Start Ollama (`ollama serve`) or `docker compose up -d ollama`.');
    process.exit(1);
  }
  console.log(`✓ Local model server reachable at ${cfg.baseUrl} (${models.length} model(s))`);

  const wanted = cfg.model;
  const present = models.some((m) => m === wanted || m === `${wanted}:latest` || m.split(':')[0] === wanted);
  if (!present) {
    console.error(`✗ Model "${wanted}" not found. Available: ${models.join(', ') || 'none'}`);
    console.error(`  Pull it with: ollama pull ${wanted}`);
    process.exit(1);
  }
  console.log(`✓ Model "${wanted}" is available`);

  const started = Date.now();
  const chat = new OpenAI({ apiKey: 'not-needed', baseURL: cfg.baseUrl, timeout: cfg.timeoutMs, maxRetries: 0 });
  const res = await chat.chat.completions.create({
    model: wanted,
    messages: [{ role: 'user', content: 'Reply with exactly: ARGUS online' }],
    max_tokens: 2048,
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort as never } : {}),
  });
  const text = res.choices[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  console.log(`✓ Test reply in ${((Date.now() - started) / 1000).toFixed(1)}s: ${text}`);

  await checkSpeech();
}

/** On-ship speech server (deep-space tier). Optional: warns instead of failing. */
async function checkSpeech() {
  const speech = localSpeechConfig(process.env);
  if (!speech) {
    console.log('· On-ship speech not configured (AI_LOCAL_SPEECH_BASE_URL unset): the browser voice is used off-Earth.');
    return;
  }
  if (!(await probeLocalSpeech(speech))) {
    console.warn(`! No speech server at ${speech.baseUrl}. Start it with \`docker compose up -d speaches\`.`);
    return;
  }
  console.log(`✓ Speech server reachable at ${speech.baseUrl}`);
  const tts = await localSynthesize(speech, 'ARGUS on-ship voice online.');
  console.log(tts ? `✓ TTS works (${speech.ttsModel})` : `! TTS failed. Download it: uvx speaches-cli model download ${speech.ttsModel}`);
  if (tts) {
    const text = await localTranscribe(speech, tts.audioBase64, 'audio/wav');
    console.log(text ? `✓ STT works (${speech.sttModel}): "${text}"` : `! STT failed. Download it: uvx speaches-cli model download ${speech.sttModel}`);
  }
}

main().catch((err) => {
  console.error('✗ Local model check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
