import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createContainer } from '../src/runtime/container.ts';
import type { AppContainer } from '../src/runtime/container.ts';
import { readEnv } from '../src/runtime/env.ts';
import { MastraDraftModel } from '../src/adapters/mastra/model.ts';
import { assertCostBudget } from '../src/core/guards/index.ts';

// A contract stand-in exercises the actual Mastra router, HTTP request, and Responses decoder.
function respond(response: ServerResponse, output: unknown, incomplete = false, streaming = false) {
  const text = JSON.stringify(output);
  const part = { type: 'output_text', text, annotations: [], logprobs: [] };
  const item = { type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed', content: [part] };
  const base = { id: 'resp_synthetic', object: 'response', created_at: 1800000000, model: 'gpt-6-luna' };
  const events = [
    { type: 'response.created', response: { ...base, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: text, logprobs: [] },
    { type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text, logprobs: [] },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: incomplete ? 'response.incomplete' : 'response.completed', response: { ...base, status: incomplete ? 'incomplete' : 'completed', output: [item], incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null, usage: { input_tokens: 120, output_tokens: 35, total_tokens: 155, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
  if (!streaming) { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(events.at(-1)!.response)); return; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(events.map((event, index) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join(''));
}

let app: AppContainer;
let directory: string;
let requests: Record<string, any>[];
let behavior: 'ok' | 'rate-limit' | 'hang' | 'invalid' | 'pii' | 'incomplete';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  requests.push(input);
  if (request.url !== '/v1/responses') { response.writeHead(501).end(); return; }
  if (behavior === 'rate-limit') { response.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'synthetic private upstream error', type: 'rate_limit_error', code: 'rate_limit_exceeded' } })); return; }
  if (behavior === 'hang') return;
  const isClassification = !!input.text?.format?.schema?.properties?.label;
  const label = app.playbooks.find(item => item.id === 'demo')!.labels[0];
  respond(response, behavior === 'invalid' ? { unexpected: true } : isClassification ? { label: label.id } : { subject: label.subject, body: label.body + (behavior === 'pii' ? '\nfiction@example.test' : '') }, behavior === 'incomplete', input.stream === true);
});

beforeEach(async () => {
  requests = []; behavior = 'ok';
  directory = await mkdtemp(join(tmpdir(), 'followup-llm-'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { ...readEnv(new URL('..', import.meta.url).pathname, {}), dbUrl: `file:${directory}/records.db`, workflowDbUrl: `file:${directory}/workflow.db`, outputDirectory: join(directory, 'out') };
  app = await createContainer(config);
  app.engine.deps.model = new MastraDraftModel({ fast: 'openai/gpt-6-luna', writer: 'openai/gpt-6-luna', apiKey: 'synthetic-test-credential' }, `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
  app.engine.deps.modelBudget!.totalUsd = 1;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('uses native structured output, strips contacts, records usage, and reaches human review', async () => {
  const original = app.engine.deps.users.getContext.bind(app.engine.deps.users);
  vi.spyOn(app.engine.deps.users, 'getContext').mockImplementation(async id => ({ ...await original(id), email: 'fiction@example.test', name: 'Synthetic Person' }));
  const contact = vi.spyOn(app.engine.deps.users, 'getContact');
  const run = await app.start('demo', 1);
  const result = await app.wait(run.id);
  expect(result.run.error).toBeUndefined();
  expect(result.run.status).toBe('waiting_approval');
  expect(requests).toHaveLength(2);
  expect(requests[0].model).toBe('gpt-6-luna');
  expect(requests[0].text.format.type).toBe('json_schema');
  expect(requests[0].max_output_tokens).toBe(256);
  expect(requests[1].max_output_tokens).toBe(2048);
  expect(requests[0].store).toBe(false);
  expect(requests[0].service_tier).toBe('default');
  expect(requests[0].reasoning.effort).toBe('none');
  expect(JSON.stringify(requests)).not.toMatch(/fiction@example|Synthetic Person/);
  expect(contact).not.toHaveBeenCalled();
  expect(result.run.usage).toEqual({ modelCalls: 2, llmCalls: 2, inputTokens: 240, outputTokens: 70 });
  expect(result.run.calls!.every(call => call.state === 'reported')).toBe(true);
  expect(await app.store.totalCostUsd()).toBeCloseTo(0.000059, 8);
  const draft = result.drafts[0];
  await app.review(run.id, draft.id, { version: 1, decision: 'approved', subject: draft.subject, body: draft.body });
  expect((await app.wait(run.id)).drafts[0].status).toBe('simulated');
  expect(requests).toHaveLength(2);
});

it('does not retry 429 and retains an unknown reservation without leaking provider text', async () => {
  behavior = 'rate-limit';
  const run = await app.start('demo', 1);
  const result = await app.wait(run.id);
  expect(result.run.status).toBe('failed');
  expect(result.run.error).toBe('MODEL_RATE_LIMIT');
  expect(requests).toHaveLength(1);
  expect(result.run.usage.llmCalls).toBe(1);
  expect(result.run.calls![0].state).toBe('unknown');
  expect(JSON.stringify(result)).not.toContain('private upstream');
  expect(result.drafts).toHaveLength(0);
});

it.each(['invalid', 'pii', 'incomplete'] as const)('keeps %s output out of the approval queue', async mode => {
  behavior = mode;
  const run = await app.start('demo', 1);
  const result = await app.wait(run.id);
  expect(result.run.status).toBe('failed');
  expect(result.drafts).toHaveLength(0);
  expect(requests).toHaveLength(mode === 'pii' ? 2 : 1);
  expect(JSON.stringify(result)).not.toContain('fiction@example.test');
});

it('aborts a stalled HTTP call on timeout and preserves its reservation across manual retry', async () => {
  behavior = 'hang'; app.engine.deps.modelBudget!.timeoutMs = 200;
  const run = await app.start('demo', 1);
  const failed = await app.wait(run.id);
  expect(failed.run.error).toBe('MODEL_TIMEOUT');
  expect(failed.run.calls![0].state).toBe('unknown');
  const reserved = await app.store.totalCostUsd();
  expect(reserved).toBeGreaterThan(0);
  behavior = 'ok'; app.engine.deps.modelBudget!.timeoutMs = 45000;
  await app.retry(run.id);
  const retried = await app.wait(run.id);
  expect(retried.run.status).toBe('waiting_approval');
  expect(retried.run.usage.llmCalls).toBe(3);
  expect(await app.store.totalCostUsd()).toBeGreaterThan(reserved);
});

it('cancels in-flight HTTP without creating a draft or starting the writer', async () => {
  behavior = 'hang';
  const run = await app.start('demo', 1);
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  await app.engine.cancel(run.id);
  const cancelled = await app.wait(run.id);
  expect(cancelled.run.status).toBe('cancelled');
  expect(cancelled.run.calls![0].state).toBe('unknown');
  expect(cancelled.drafts).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

it('persists unknown usage after a restart and blocks repeated calls at the run limit', async () => {
  behavior = 'rate-limit'; app.config.limits.maxCalls = 1;
  const run = await app.start('demo', 1);
  await app.wait(run.id);
  const config = app.config;
  const reserved = await app.store.totalCostUsd();
  await app.store.mutate(run.id, detail => {
    detail.run.status = 'running'; detail.run.ownerPid = 2147483647;
    detail.run.calls![0].state = 'reserved';
  });
  await app.close();
  app = await createContainer(config);
  const interrupted = await app.store.getRun(run.id);
  expect(interrupted.run.status).toBe('interrupted');
  expect(interrupted.run.calls![0].state).toBe('unknown');
  expect(await app.store.totalCostUsd()).toBe(reserved);
  await expect(app.retry(run.id)).rejects.toThrow('MODEL_CHANGED');
  app.engine.deps.model = new MastraDraftModel({ fast: 'openai/gpt-6-luna', writer: 'openai/gpt-6-luna', apiKey: 'synthetic-test-credential' }, `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
  app.engine.deps.modelBudget!.totalUsd = 1;
  await app.retry(run.id);
  expect((await app.wait(run.id)).run.error).toBe('CALL_LIMIT');
  expect(requests).toHaveLength(1);
});

it.each(['cost', 'tokens'] as const)('stops before HTTP when the %s reservation cannot fit', async limit => {
  if (limit === 'cost') app.engine.deps.modelBudget!.totalUsd = 0;
  else app.config.limits.dailyTokens = 1;
  const run = await app.start('demo', 1);
  const failed = await app.wait(run.id);
  expect(failed.run.error).toBe(limit === 'cost' ? 'COST_LIMIT' : 'TOKEN_LIMIT');
  expect(requests).toHaveLength(0);
  expect(failed.run.usage.llmCalls).toBe(0);
});

it('attributes usage to the local call date across midnight and retains prior day costs', async () => {
  vi.spyOn(app.engine.deps.clock, 'now').mockReturnValue('2026-11-10T15:59:59.000Z');
  const original = app.engine.deps.model.classify.bind(app.engine.deps.model);
  vi.spyOn(app.engine.deps.model, 'classify').mockImplementation(async (...args) => {
    const result = await original(...args);
    vi.spyOn(app.engine.deps.clock, 'now').mockReturnValue('2026-11-10T16:00:01.000Z');
    return result;
  });
  const run = await app.start('demo', 1);
  await app.wait(run.id);
  expect(await app.store.dailyTokens('2026-11-10')).toBe(155);
  expect(await app.store.dailyTokens('2026-11-11')).toBe(155);
  expect(await app.store.totalCostUsd()).toBeCloseTo(0.000059, 8);
});

it('validates cost limits and rejects model configuration errors without exposing values', () => {
  expect(() => assertCostBudget(0.5, 0.5, 1)).not.toThrow();
  expect(() => assertCostBudget(0.5, 0.51, 1)).toThrow('COST_LIMIT');
  expect(() => assertCostBudget(0, NaN, 1)).toThrow('COST_LIMIT');
  expect(() => readEnv(directory, { MODEL_MODE: 'openai' })).toThrow('OPENAI_API_KEY');
  expect(() => readEnv(directory, { MODEL_WRITER: 'unpriced-model' })).toThrow('MODEL_WRITER');
  expect(() => readEnv(directory, { BUDGET_TIMEZONE: 'invalid' })).toThrow('BUDGET_TIMEZONE');
});
