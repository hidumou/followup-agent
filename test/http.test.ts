import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer } from '../src/runtime/container.ts';
import type { AppContainer } from '../src/runtime/container.ts';
import { createHttpServer } from '../src/runtime/http.ts';
import { readEnv } from '../src/runtime/env.ts';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

let app: AppContainer;
let server: Server;
let directory: string;
let base: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'followup-http-'));
  app = await createContainer({ ...readEnv(new URL('..', import.meta.url).pathname, {}), dbUrl: `file:${directory}/records.db`, workflowDbUrl: `file:${directory}/workflow.db`, outputDirectory: join(directory, 'out') });
  server = createHttpServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await app.close(); await rm(directory, { recursive: true, force: true }); });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

it('exposes a working start, status, review and simulated-send contract', async () => {
  app.config.model.apiKey = 'synthetic-private-config-value';
  const configResponse = await fetch(base + '/api/config');
  expect(configResponse.status).toBe(200);
  const configBody = await configResponse.text();
  expect(configBody).not.toContain('synthetic-private-config-value');
  expect(configBody).not.toContain('apiKey');
  expect(JSON.parse(configBody).model.mode).toBe('stub');
  const response = await post('/api/runs', { playbook: 'demo', maxUsers: 1 });
  expect(response.status).toBe(202);
  const { run } = await response.json();
  const detail = await app.wait(run.id);
  expect((await fetch(base + `/api/runs/${run.id}`)).status).toBe(200);
  expect((await post('/api/runs', { playbook: 'demo', maxUsers: 1 })).status).toBe(409);
  const draft = detail.drafts[0];
  const approval = await post(`/api/runs/${run.id}/drafts/${draft.id}/review`, { version: 1, decision: 'approved', subject: draft.subject, body: draft.body });
  expect(approval.status).toBe(200);
  expect((await app.wait(run.id)).run.status).toBe('completed');
  expect((await fetch(base + '/api/runs')).headers.get('cache-control')).toBe('no-store');
});

it('rejects malformed, oversized, cross-origin and DNS-rebinding requests', async () => {
  expect((await post('/api/runs', { playbook: 'demo', maxUsers: 1, extra: true })).status).toBe(400);
  expect((await post('/api/runs', { playbook: 'demo', maxUsers: 1 }, { origin: 'https://untrusted.invalid' })).status).toBe(403);
  const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(base + '/api/config', { headers: { host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  expect(invalidHostStatus).toBe(403);
  expect((await fetch(base + '/api/runs', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
  expect((await post('/api/runs', { value: 'x'.repeat(17000) })).status).toBe(413);
  const invalid = await post('/api/runs', { playbook: '../../private', maxUsers: 1 });
  expect(invalid.status).toBe(404);
  expect(await invalid.json()).toEqual({ error: 'PLAYBOOK_NOT_FOUND' });
});

it('exposes persisted schedule controls without accepting arbitrary execution or time overrides', async () => {
  const initial = await (await fetch(base + '/api/schedule')).json();
  expect(initial.schedule.enabled).toBe(false);
  expect(initial.schedule.timezone).toBe('Asia/Taipei');
  expect(initial.runner).toHaveProperty('loaded');
  expect((await post('/api/schedule', { enabled: true, version: 1 })).status).toBe(200);
  expect((await (await fetch(base + '/api/schedule')).json()).schedule.nextRunAt).toBeTruthy();
  expect((await post('/api/schedule', { enabled: false, version: 1 })).status).toBe(409);
  expect((await post('/api/schedule', { enabled: true, version: 2, at: '2026-11-10T01:00:00.000Z' })).status).toBe(400);
  expect((await post('/api/schedule', { enabled: false, version: 2 }, { origin: 'https://untrusted.invalid' })).status).toBe(403);
  expect((await post('/api/schedule', { enabled: false, version: 2 })).status).toBe(200);
  expect(await app.store.listRuns()).toHaveLength(0);
});
