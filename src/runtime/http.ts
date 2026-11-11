import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AppError } from '../core/domain/index.ts';
import type { AppContainer } from './container.ts';
import { runnerStatus } from '../adapters/launchd/scheduler.ts';

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
const startSchema = z.object({ playbook: z.string(), maxUsers: z.number().int().positive() }).strict();
const reviewSchema = z.object({ version: z.number().int().positive(), decision: z.enum(['approved', 'rejected']), subject: z.string().max(160), body: z.string().max(5000) }).strict();
const idSchema = z.uuid();

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('JSON_REQUIRED', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 16384) throw new AppError('BODY_TOO_LARGE', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON'); }
}
export function createHttpServer(app: AppContainer, assets: () => Middleware | undefined = () => undefined) {
  return createServer(async (request, response) => {
    const respond = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(JSON.stringify(value));
    };
    try {
      const host = request.headers.host ?? '';
      const address = response.socket?.localPort;
      if (![`127.0.0.1:${address}`, `localhost:${address}`].includes(host)) throw new AppError('INVALID_HOST', 403);
      if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('INVALID_ORIGIN', 403);
      const path = new URL(request.url ?? '/', `http://${host}`).pathname;
      const method = request.method;
      if (!path.startsWith('/api/')) {
        const handler = assets();
        if (handler) handler(request, response, () => respond(404, { error: 'NOT_FOUND' }));
        else respond(404, { error: 'NOT_FOUND' });
        return;
      }
      if (method === 'GET' && path === '/api/config') return respond(200, { playbooks: app.playbooks, defaultPlaybook: app.config.playbook, limits: app.config.limits, mode: 'dry-run', model: app.engine.deps.model.info ?? { mode: 'stub', fast: 'stub', writer: 'stub' }, budgetUsd: app.config.model.budgetUsd });
      if (method === 'GET' && path === '/api/runs') return respond(200, { runs: await app.store.listRuns() });
      if (method === 'GET' && path === '/api/schedule') return respond(200, { ...await app.store.getSchedule(), runner: await runnerStatus(app.config) });
      if (method === 'POST' && path === '/api/schedule') {
        const input = z.object({ enabled: z.boolean(), version: z.number().int().positive() }).strict().parse(await body(request));
        return respond(200, { schedule: await app.store.setScheduleEnabled(input.enabled, input.version) });
      }
      if (method === 'POST' && path === '/api/runs') {
        const input = startSchema.parse(await body(request));
        return respond(202, { run: await app.start(input.playbook, input.maxUsers) });
      }
      const route = path.match(/^\/api\/runs\/([^/]+)(?:\/(cancel|retry|drafts)(?:\/([^/]+)\/review)?)?$/);
      if (!route) throw new AppError('NOT_FOUND', 404);
      const [, rawId, action, draftId] = route;
      const id = idSchema.parse(rawId);
      if (method === 'GET' && !action) return respond(200, await app.store.getRun(id));
      if (method === 'POST' && action) {
        const input = await body(request);
        if (action === 'drafts' && draftId) return respond(200, await app.review(id, idSchema.parse(draftId), reviewSchema.parse(input)));
        z.object({}).strict().parse(input);
        if (action === 'cancel') return respond(200, await app.engine.cancel(id));
        if (action === 'retry') return respond(202, await app.retry(id));
      }
      throw new AppError('METHOD_NOT_ALLOWED', 405);
    } catch (error) {
      if (error instanceof AppError) respond(error.status, { error: error.code });
      else if (error instanceof z.ZodError) respond(400, { error: 'INVALID_INPUT' });
      else respond(500, { error: 'INTERNAL_ERROR' });
    }
  });
}
