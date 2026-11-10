import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createContainer } from '../src/runtime/container.ts';
import type { AppContainer } from '../src/runtime/container.ts';
import { readEnv } from '../src/runtime/env.ts';
import type { AppConfig } from '../src/runtime/env.ts';
import { SendService } from '../src/core/send/service.ts';

let directory: string;
let config: AppConfig;
let app: AppContainer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'followup-test-'));
  config = { ...readEnv(new URL('..', import.meta.url).pathname, {}), dbUrl: `file:${directory}/records.db`, workflowDbUrl: `file:${directory}/workflows.db`, outputDirectory: join(directory, 'out') };
  app = await createContainer(config);
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); await rm(directory, { recursive: true, force: true }); });

async function approveAll(runId: string) {
  for (const draft of (await app.store.getRun(runId)).drafts.filter(item => item.status === 'pending_approval')) {
    await app.review(runId, draft.id, { version: draft.version, decision: 'approved', subject: draft.subject, body: draft.body });
  }
  return app.wait(runId);
}

describe('persistent mock platform', () => {
  it('suspends, survives restart, records edits and rejection, and resumes exactly once', async () => {
    const contact = vi.spyOn(app.engine.deps.users, 'getContact');
    const run = await app.start('demo', 3);
    const waiting = await app.wait(run.id);
    expect(waiting.run.status).toBe('waiting_approval');
    expect(waiting.run.usage).toEqual({ modelCalls: 6, llmCalls: 0, inputTokens: 0, outputTokens: 0 });
    expect(contact).not.toHaveBeenCalled();
    expect((await readdir(join(directory, 'out/drafts'))).length).toBe(3);
    await app.close();
    app = await createContainer(config);
    expect((await app.store.getRun(run.id)).run.status).toBe('waiting_approval');
    const [first, second, third] = waiting.drafts;
    await app.review(run.id, first.id, { version: 1, decision: 'approved', subject: '想听听你的建议', body: first.body });
    await app.review(run.id, second.id, { version: 1, decision: 'rejected', subject: second.subject, body: second.body });
    await app.review(run.id, third.id, { version: 1, decision: 'approved', subject: third.subject, body: third.body });
    const complete = await app.wait(run.id);
    expect(complete.run.status).toBe('completed');
    expect(complete.drafts.map(draft => draft.status)).toEqual(['simulated', 'rejected', 'simulated']);
    expect(complete.edits).toHaveLength(3);
    expect(complete.edits[0].before.subject).toBe(first.subject);
    expect(complete.edits[0].after.subject).toBe('想听听你的建议');
    expect((await readdir(join(directory, 'out/simulated'))).length).toBe(2);
    const receipt = await readFile(join(directory, 'out/simulated', `${first.id}.json`), 'utf8');
    expect(receipt).not.toContain('email');
    expect(receipt).not.toContain('recipient');
    await expect(app.review(run.id, first.id, { version: 1, decision: 'approved', subject: first.subject, body: first.body })).rejects.toThrow('RUN_NOT_REVIEWABLE');
  });

  it('limits users, deduplicates completed work, and swaps business without core changes', async () => {
    const first = await app.start('demo', 6);
    await app.wait(first.id);
    await approveAll(first.id);
    const second = await app.start('demo', 6);
    const empty = await app.wait(second.id);
    expect(empty.run.status).toBe('completed');
    expect(empty.drafts).toHaveLength(0);
    expect(empty.run.skipped).toBe(6);
    const alternate = await app.start('demo-alt', 2);
    const result = await app.wait(alternate.id);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].label).toBe('first-lesson');
    expect(result.drafts[0].subject).toContain('课');
  });

  it('rejects concurrent runs and concurrent duplicate approvals', async () => {
    const starts = await Promise.allSettled([app.start('demo', 1), app.start('demo', 1)]);
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const run = starts.find(result => result.status === 'fulfilled')!;
    if (run.status !== 'fulfilled') throw new Error('Expected run');
    const detail = await app.wait(run.value.id);
    const draft = detail.drafts[0];
    const review = { version: 1, decision: 'approved' as const, subject: draft.subject, body: draft.body };
    const decisions = await Promise.allSettled([app.review(run.value.id, draft.id, review), app.review(run.value.id, draft.id, review)]);
    expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await app.wait(run.value.id)).run.status).toBe('completed');
    expect((await readdir(join(directory, 'out/simulated'))).length).toBe(1);
  });

  it('stops before exceeding model-call budget and never calls the writer', async () => {
    app.config.limits.maxCalls = 1;
    const writer = vi.spyOn(app.engine.deps.model, 'draft');
    const run = await app.start('demo', 2);
    const failed = await app.wait(run.id);
    expect(failed.run.status).toBe('failed');
    expect(failed.run.error).toBe('CALL_LIMIT');
    expect(failed.run.usage.modelCalls).toBe(1);
    expect(writer).not.toHaveBeenCalled();
    await app.retry(run.id);
    expect((await app.wait(run.id)).run.usage.modelCalls).toBe(1);
    expect(writer).not.toHaveBeenCalled();
  });

  it('cancels at a checkpoint and supports explicit retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = app.engine.deps.model.classify.bind(app.engine.deps.model);
    const classify = vi.spyOn(app.engine.deps.model, 'classify').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    const run = await app.start('demo', 1);
    await vi.waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    await app.engine.cancel(run.id);
    release();
    const cancelled = await app.wait(run.id);
    expect(cancelled.run.status).toBe('cancelled');
    expect(cancelled.drafts).toHaveLength(0);
    await app.retry(run.id);
    const retried = await app.wait(run.id);
    expect(retried.run.status).toBe('waiting_approval');
    expect(retried.run.attempt).toBe(2);
    expect(retried.drafts).toHaveLength(1);
  });

  it('retains committed drafts after an export failure and does not regenerate them', async () => {
    const output = vi.spyOn(app.engine.deps.files, 'saveDraft').mockRejectedValueOnce(new Error('Synthetic export failure'));
    const run = await app.start('demo', 2);
    const failed = await app.wait(run.id);
    expect(failed.run.status).toBe('failed');
    expect(failed.drafts).toHaveLength(1);
    const id = failed.drafts[0].id;
    output.mockRestore();
    await app.retry(run.id);
    const retried = await app.wait(run.id);
    expect(retried.run.status).toBe('waiting_approval');
    expect(retried.drafts).toHaveLength(2);
    expect(retried.drafts[0].id).toBe(id);
    expect(retried.run.usage.modelCalls).toBe(4);
  });

  it('marks abandoned processes interrupted without resuming work', async () => {
    const run = await app.engine.create(app.playbooks[0], config.limits);
    await app.store.mutate(run.id, detail => { detail.run.status = 'running'; detail.run.ownerPid = 2147483647; });
    await app.close();
    app = await createContainer(config);
    const interrupted = await app.store.getRun(run.id);
    expect(interrupted.run.status).toBe('interrupted');
    expect(interrupted.drafts).toHaveLength(0);
    expect(interrupted.run.usage.modelCalls).toBe(0);
  });

  it('blocks unapproved sends and unsafe edits without persisting those edits', async () => {
    const run = await app.start('demo', 1);
    const { drafts: [draft] } = await app.wait(run.id);
    const mailer = { simulate: vi.fn() };
    await expect(new SendService(mailer).simulate(draft, app.playbooks[0])).rejects.toThrow('APPROVAL_REQUIRED');
    expect(mailer.simulate).not.toHaveBeenCalled();
    await expect(app.review(run.id, draft.id, { version: 1, decision: 'approved', subject: draft.subject, body: `${draft.body}\nfiction@example.test` })).rejects.toThrow('GUARD_REJECTED');
    const unchanged = await app.store.getRun(run.id);
    expect(unchanged.edits).toHaveLength(0);
    expect(JSON.stringify(unchanged)).not.toContain('fiction@example.test');
  });

  it('creates no foreign keys in business or framework storage', async () => {
    for (const url of [config.dbUrl, config.workflowDbUrl]) {
      const client = createClient({ url });
      try {
        const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
        expect(tables.rows.length).toBeGreaterThan(0);
        for (const table of tables.rows) {
          const name = String(table.name).replaceAll('"', '""');
          expect((await client.execute(`PRAGMA foreign_key_list("${name}")`)).rows, String(table.name)).toHaveLength(0);
        }
      } finally { client.close(); }
    }
  });
});
