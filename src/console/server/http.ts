import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import type { HttpBindings } from '@hono/node-server';
import { z } from 'zod';
import { AppError } from '../../core/domain/index.ts';
import type { AppContainer } from '../../runtime/container.ts';
import { runnerStatus } from '../../adapters/launchd/scheduler.ts';
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
const startSchema = z.object({
  playbook: z.string(),
  maxUsers: z.number().int().positive()
}).strict();
const reviewSchema = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  subject: z.string().max(160),
  body: z.string().max(5000)
}).strict();
const filtersSchema = z.object({
  status: z.enum(['discovered', 'pending_approval', 'approved', 'rejected', 'simulated', 'failed', 'cancelled', 'interrupted']).optional(),
  label: z.string().max(100).optional(),
  playbook: z.string().max(100).optional(),
  version: z.string().regex(/^(legacy|[1-9][0-9]*)$/).optional(),
  query: z.string().max(100).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  sort: z.enum(['newest', 'oldest']).optional()
}).strict();
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length')) > 16384) throw new AppError('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) while (true) {
      const {
        done,
        value
      } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new AppError('BODY_TOO_LARGE', 413);
      chunks.push(value);
    }
  } finally {
    reader?.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON');
  }
}
export function createHttpServer(app: AppContainer, assets: () => Middleware | undefined = () => undefined) {
  const token = randomBytes(32).toString('base64url');
  const router = new Hono<{
    Bindings: HttpBindings;
  }>();
  const {
    queries,
    operations
  } = app.services;
  router.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.req.header('sec-fetch-site') === 'cross-site') throw new AppError('INVALID_ORIGIN', 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const provided = Buffer.from(c.req.header('x-followup-session') ?? '');
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new AppError('INVALID_SESSION', 403);
    }
    await next();
  });
  router.get('/api/session', c => c.json({
    token
  }));
  router.get('/api/config', c => c.json({
    playbooks: app.playbooks,
    defaultPlaybook: app.config.playbook,
    limits: app.config.limits,
    mode: 'dry-run',
    model: app.engine.deps.model.info ?? {
      mode: 'stub',
      fast: 'stub',
      writer: 'stub'
    },
    budgetUsd: app.config.model.budgetUsd
  }));
  router.get('/api/overview', async c => c.json(await queries.overview()));
  router.get('/api/followups', async c => c.json(await queries.followups(filtersSchema.parse(c.req.query()))));
  router.get('/api/followups/:id', async c => c.json(await queries.followup(c.req.param('id'))));
  router.get('/api/approvals', async c => c.json({
    queue: await queries.approvalQueue()
  }));
  router.post('/api/runs/:id/guard-check', async c => c.json(await queries.previewDraft(z.uuid().parse(c.req.param('id')), z.object({
    subject: z.string().max(160),
    body: z.string().max(5000)
  }).strict().parse(await jsonBody(c.req.raw)))));
  router.get('/api/runs', async c => c.json({
    runs: await queries.listRuns()
  }));
  router.get('/api/runs/:id', async c => c.json(await queries.getRun(z.uuid().parse(c.req.param('id')))));
  router.post('/api/runs', async c => {
    const input = startSchema.parse(await jsonBody(c.req.raw));
    return c.json({
      run: await operations.start(input.playbook, input.maxUsers)
    }, 202);
  });
  router.post('/api/runs/:id/:action', async c => {
    const id = z.uuid().parse(c.req.param('id'));
    z.object({}).strict().parse(await jsonBody(c.req.raw));
    if (c.req.param('action') === 'cancel') return c.json(await operations.cancel(id));
    if (c.req.param('action') === 'retry') return c.json(await operations.retry(id), 202);
    throw new AppError('NOT_FOUND', 404);
  });
  router.post('/api/runs/:id/drafts/:draftId/review', async c => c.json(await operations.review(z.uuid().parse(c.req.param('id')), z.uuid().parse(c.req.param('draftId')), reviewSchema.parse(await jsonBody(c.req.raw)))));
  router.get('/api/schedule', async c => c.json({
    ...(await app.store.getSchedule()),
    runner: await runnerStatus(app.config)
  }));
  router.post('/api/schedule', async c => {
    const input = z.object({
      enabled: z.boolean(),
      version: z.number().int().positive()
    }).strict().parse(await jsonBody(c.req.raw));
    return c.json({
      schedule: await operations.setSchedule(input.enabled, input.version)
    });
  });
  router.notFound(c => c.json({
    error: 'NOT_FOUND'
  }, 404));
  router.onError((error, c) => {
    if (error instanceof AppError) return c.json({
      error: error.code
    }, error.status as 400);
    if (error instanceof z.ZodError) return c.json({
      error: 'INVALID_INPUT'
    }, 400);
    return c.json({
      error: 'INTERNAL_ERROR'
    }, 500);
  });
  const listener = getRequestListener(router.fetch, {
    overrideGlobalObjects: false,
    autoCleanupIncoming: true
  });
  return createServer((request, response) => {
    const host = request.headers.host ?? '';
    const port = request.socket.localPort;
    const fail = (status: number, code: string) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      response.end(JSON.stringify({
        error: code
      }));
    };
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return fail(403, 'INVALID_HOST');
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return fail(403, 'INVALID_ORIGIN');
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
    } catch {
      return fail(400, 'INVALID_URL');
    }
    if (!pathname.startsWith('/api/')) {
      const handler = assets();
      if (handler) return handler(request, response, () => fail(404, 'NOT_FOUND'));
      return fail(404, 'NOT_FOUND');
    }
    void listener(request, response).catch(() => {
      if (!response.headersSent) fail(500, 'INTERNAL_ERROR');else response.destroy();
    });
  });
}
