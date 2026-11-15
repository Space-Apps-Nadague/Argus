import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { aiGuard } from './auth/aiGuard';
import { dbMiddleware, originGuard, requireAuth, sessionMiddleware } from './auth/session';
import type { AppEnv } from './auth/types';
import { adminRoutes } from './routes/admin';
import { astronautRoutes } from './routes/astronauts';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { dataRoutes } from './routes/data';
import { familyRoutes } from './routes/family';
import { diagnosticsRoutes } from './routes/diagnostics';
import { guidanceRoutes } from './routes/guidance';
import { healthRoutes } from './routes/health';
import { recommendationsRoutes } from './routes/recommendations';
import { visionRoutes } from './routes/vision';
import { voiceRoutes } from './routes/voice';
import { wellbeingRoutes } from './routes/wellbeing';

/** Hono app factory (also used directly by tests via `app.request`). */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const origins = (process.env.ARGUS_CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use('/api/*', cors({ origin: origins, allowHeaders: ['Content-Type', 'X-AI-Key', 'Authorization'], credentials: true }));
  app.use('/api/*', bodyLimit({ maxSize: 15 * 1024 * 1024 }));
  app.use('/api/*', dbMiddleware, sessionMiddleware, originGuard(origins));

  app.route('/api', healthRoutes);
  app.route('/api', authRoutes);
  app.route('/api', adminRoutes);
  app.route('/api', astronautRoutes);
  app.route('/api', dataRoutes);
  app.route('/api', familyRoutes);
  const ai = new Hono<AppEnv>();
  ai.use('*', requireAuth(), aiGuard);
  ai.route('/', guidanceRoutes);
  ai.route('/', visionRoutes);
  ai.route('/', diagnosticsRoutes);
  ai.route('/', recommendationsRoutes);
  ai.route('/', wellbeingRoutes);
  ai.route('/', chatRoutes);
  ai.route('/', voiceRoutes);
  app.route('/api/ai', ai);

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (existsSync(resolve(process.cwd(), 'dist', 'index.html'))) {
    app.use('*', serveStatic({ root: './dist' }));
    app.get('*', serveStatic({ path: './dist/index.html' }));
  }

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    console.error('[ARGUS server]', err);
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}
