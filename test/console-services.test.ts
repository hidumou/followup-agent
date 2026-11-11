import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer } from '../src/runtime/container.ts';
import type { AppContainer } from '../src/runtime/container.ts';
import { readEnv } from '../src/runtime/env.ts';
import { projectFollowups } from '../src/core/services/index.ts';
let app: AppContainer;
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'followup-console-'));
  app = await createContainer({
    ...readEnv(new URL('..', import.meta.url).pathname, {}),
    dbUrl: `file:${directory}/records.db`,
    workflowDbUrl: `file:${directory}/workflow.db`,
    outputDirectory: join(directory, 'out')
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await rm(directory, {
    recursive: true,
    force: true
  });
});
it('persists anonymous context, version snapshots and transactional review audit across restarts', async () => {
  const contact = vi.spyOn(app.engine.deps.users, 'getContact');
  const context = app.engine.deps.users.getContext.bind(app.engine.deps.users);
  vi.spyOn(app.engine.deps.users, 'getContext').mockImplementation(async userId => ({
    ...(await context(userId)),
    name: 'Synthetic private value',
    features: {
      ...(await context(userId)).features,
      email: 'fiction@example.test'
    }
  }) as never);
  const run = await app.services.operations.start('demo', 2);
  const waiting = await app.wait(run.id);
  expect(waiting.run.playbook.version).toBe(1);
  expect(waiting.drafts.every(draft => draft.playbookVersion === 1)).toBe(true);
  const records = await app.services.queries.followups();
  expect(records.total).toBe(2);
  const detail = await app.services.queries.followup(records.records[0].id);
  expect(detail.context?.userId).toBe(records.records[0].userId);
  expect(Object.values(detail.context!.features).every(value => ['number', 'boolean'].includes(typeof value))).toBe(true);
  expect(JSON.stringify(detail)).not.toContain('fiction@example.test');
  expect(JSON.stringify(detail)).not.toContain('Synthetic private value');
  expect(contact).not.toHaveBeenCalled();
  const draft = waiting.drafts[0];
  const before = await app.store.listAudit(run.id);
  await expect(app.services.operations.review(run.id, draft.id, {
    version: 1,
    decision: 'approved',
    subject: draft.subject,
    body: draft.body + '\nfiction@example.test'
  })).rejects.toThrow('GUARD_REJECTED');
  expect(await app.store.listAudit(run.id)).toEqual(before);
  await app.services.operations.review(run.id, draft.id, {
    version: 1,
    decision: 'approved',
    subject: '想听听你的使用建议',
    body: draft.body
  });
  const audit = (await app.store.listAudit(run.id)).find(entry => entry.action === 'draft.approved')!;
  expect(audit).toMatchObject({
    actor: 'operator',
    objectType: 'draft',
    objectId: draft.id,
    playbookVersion: 1,
    before: {
      pending: 2
    },
    after: {
      pending: 1,
      approved: 1
    }
  });
  expect(JSON.stringify(audit)).not.toContain(draft.body);
  const config = app.config;
  await app.close();
  app = await createContainer(config);
  expect((await app.services.queries.followup(records.records[0].id)).context).toEqual(detail.context);
  expect((await app.store.listAudit(run.id)).find(entry => entry.id === audit.id)).toEqual(audit);
});
it('rolls back business changes when the audit insert fails', async () => {
  const run = await app.start('demo', 1);
  const {
    drafts: [draft]
  } = await app.wait(run.id);
  await app.store.client.execute("CREATE TRIGGER fail_operator_audit BEFORE INSERT ON audit_logs WHEN json_extract(NEW.payload, '$.actor') = 'operator' BEGIN SELECT RAISE(ABORT, 'synthetic-audit-failure'); END");
  await expect(app.review(run.id, draft.id, {
    version: 1,
    decision: 'approved',
    subject: draft.subject,
    body: draft.body
  })).rejects.toThrow();
  const detail = await app.store.getRun(run.id);
  expect(detail.drafts[0].status).toBe('pending_approval');
  expect(detail.edits).toHaveLength(0);
  await app.store.client.execute('DROP TRIGGER fail_operator_audit');
});
it('keeps historical records explicit and filters/paginates per-user records deterministically', async () => {
  const run = app.engine.prepare({
    ...app.playbooks[0],
    version: undefined
  }, app.config.limits);
  run.status = 'completed';
  run.ownerPid = null;
  run.createdAt = '2026-01-01T00:00:00.000Z';
  run.userIds = Array.from({
    length: 30
  }, (_, index) => `usr_${index.toString(16).padStart(12, '0')}`);
  await app.store.createRun(run);
  const page = await app.services.queries.followups({
    version: 'legacy',
    page: 2
  });
  expect(page).toMatchObject({
    total: 30,
    page: 2,
    pages: 2
  });
  expect(page.records).toHaveLength(5);
  expect(page.records.every(record => record.playbookVersion === null && record.confidence === null)).toBe(true);
  const first = await app.services.queries.followups({
    query: '00001d'
  });
  expect(first.total).toBe(1);
  const detail = await app.services.queries.followup(first.records[0].id);
  expect(detail.context).toBe(null);
  expect((await app.services.queries.followups({
    version: '1'
  })).total).toBe(0);
  expect((await app.services.queries.followups({
    days: 1
  })).total).toBe(0);
  const persisted = await app.store.getRun(run.id);
  persisted.run.status = 'interrupted';
  expect(projectFollowups(persisted).every(record => record.status === 'interrupted')).toBe(true);
});
it('records operator schedule/cancel/retry actions and excludes cancelled drafts from approval', async () => {
  await app.services.operations.setSchedule(true, 1);
  await app.services.operations.setSchedule(false, 2);
  const run = await app.start('demo', 1);
  await app.wait(run.id);
  expect((await app.services.queries.overview()).reviewable).toBe(1);
  await app.services.operations.cancel(run.id);
  expect(await app.services.queries.approvalQueue()).toEqual([]);
  expect((await app.services.queries.followups()).records[0].status).toBe('cancelled');
  await app.services.operations.retry(run.id);
  await app.wait(run.id);
  const actions = (await app.store.listAudit()).filter(entry => entry.actor === 'operator').map(entry => entry.action);
  expect(actions).toEqual(expect.arrayContaining(['schedule.enable', 'schedule.pause', 'run.start', 'run.cancel', 'run.retry']));
});
