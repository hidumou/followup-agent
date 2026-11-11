import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer } from '../src/runtime/container.ts';
import { readEnv, resolveProjectRoot } from '../src/runtime/env.ts';
import { MastraDraftModel } from '../src/adapters/mastra/model.ts';

const endpoint = process.argv[2];
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+\/openai\/v1$/.test(endpoint)) throw new Error('Pass the local simulation URL ending in /openai/v1');
const directory = await mkdtemp(join(tmpdir(), 'followup-simulation-'));
const config = { ...readEnv(resolveProjectRoot(), {}), dbUrl: `file:${directory}/records.db`, workflowDbUrl: `file:${directory}/workflow.db`, outputDirectory: join(directory, 'out') };
const app = await createContainer(config);
try {
  app.engine.deps.model = new MastraDraftModel({ fast: 'openai/gpt-6-luna', writer: 'openai/gpt-6-luna', apiKey: 'synthetic-simulation-credential' }, endpoint);
  app.engine.deps.modelBudget!.totalUsd = 1;
  const run = await app.start('demo', 1);
  const result = await app.wait(run.id);
  assert.equal(result.run.status, 'failed');
  assert.equal(result.run.usage.llmCalls, 1);
  assert.equal(result.drafts.length, 0);
  assert.equal(result.run.calls?.[0].state, 'unknown');
  console.log(JSON.stringify({ status: result.run.status, error: result.run.error, calls: result.run.usage.llmCalls, drafts: result.drafts.length, usage: 'unknown-reservation-retained' }));
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
