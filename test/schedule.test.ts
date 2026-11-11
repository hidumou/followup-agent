import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createContainer } from '../src/runtime/container.ts';
import type { AppContainer } from '../src/runtime/container.ts';
import { readEnv } from '../src/runtime/env.ts';
import type { AppConfig } from '../src/runtime/env.ts';
import { nextWeekdayRun } from '../src/core/schedule/index.ts';
import { launchdPlist } from '../src/adapters/launchd/scheduler.ts';

let app: AppContainer;
let config: AppConfig;
let directory: string;
const before = '2026-11-10T00:59:00.000Z';
const due = '2026-11-10T01:00:00.000Z';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'followup-schedule-'));
  config = { ...readEnv(new URL('..', import.meta.url).pathname, { MAX_USERS_PER_RUN: '1' }), dbUrl: `file:${directory}/records.db`, workflowDbUrl: `file:${directory}/records.db.workflow.db`, outputDirectory: join(directory, 'out') };
  app = await createContainer(config);
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); await rm(directory, { recursive: true, force: true }); });
async function enable() { await app.store.setScheduleEnabled(true, 1, before); }

it('uses Taipei weekdays independent of the host timezone, skipping weekends', () => {
  expect(nextWeekdayRun(before)).toBe(due);
  expect(nextWeekdayRun(due)).toBe('2026-11-11T01:00:00.000Z');
  expect(nextWeekdayRun('2026-11-13T01:00:00.000Z')).toBe('2026-11-16T01:00:00.000Z');
  expect(nextWeekdayRun('2026-11-15T16:30:00.000Z')).toBe('2026-11-16T01:00:00.000Z');
});

it('starts only in the planned minute, pauses for review and records the scheduled origin', async () => {
  await enable();
  expect(await app.tickSchedule(before)).toBeUndefined();
  const run = (await app.tickSchedule('2026-11-10T01:00:59.999Z'))!;
  const detail = await app.wait(run.id);
  expect(detail.run.status).toBe('waiting_approval');
  expect(detail.run.trigger).toEqual({ kind: 'scheduled', scheduleId: 'weekday-followup', plannedAt: due });
  expect(detail.drafts).toHaveLength(1);
  expect(detail.run.usage.modelCalls).toBe(2);
  expect(detail.events[0].code).toBe('SCHEDULE_TRIGGERED');
  expect(await app.tickSchedule('2026-11-10T01:00:59.999Z')).toBeUndefined();
  expect((await app.store.getSchedule()).occurrences).toHaveLength(1);
  const draft = detail.drafts[0];
  await app.review(run.id, draft.id, { version: 1, decision: 'approved', subject: draft.subject, body: draft.body });
  expect((await app.wait(run.id)).drafts[0].status).toBe('simulated');
});

it('skips every missed occurrence after downtime and never catches up', async () => {
  await enable();
  const classify = vi.spyOn(app.engine.deps.model, 'classify');
  expect(await app.tickSchedule('2026-11-12T01:01:00.000Z')).toBeUndefined();
  const snapshot = await app.store.getSchedule();
  expect(snapshot.occurrences).toHaveLength(3);
  expect(snapshot.occurrences.every(item => item.reason === 'MISSED_WINDOW')).toBe(true);
  expect(snapshot.schedule.nextRunAt).toBe('2026-11-13T01:00:00.000Z');
  expect(classify).not.toHaveBeenCalled();
  expect(await app.store.listRuns()).toHaveLength(0);
});

it('allows only one occurrence across concurrent independent database connections', async () => {
  await enable();
  const second = await createContainer(config);
  try {
    const results = await Promise.all([app.tickSchedule(due), second.tickSchedule(due)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await app.store.getSchedule()).occurrences).toHaveLength(1);
    const run = results.find(Boolean)!;
    await app.wait(run.id);
    await second.wait(run.id);
    expect(await app.store.listRuns()).toHaveLength(1);
  } finally { await second.close(); }
});

it('records an active-run skip without changing an existing approval queue', async () => {
  await enable();
  const manual = await app.start('demo', 1);
  await app.wait(manual.id);
  expect(await app.tickSchedule(due)).toBeUndefined();
  expect((await app.store.getSchedule()).occurrences[0].reason).toBe('RUN_ALREADY_ACTIVE');
  expect((await app.store.getRun(manual.id)).run.status).toBe('waiting_approval');
  await app.engine.cancel(manual.id);
  expect(await app.tickSchedule('2026-11-10T01:00:30.000Z')).toBeUndefined();
});

it('does not auto-resume a run when the process dies after the atomic schedule claim', async () => {
  await enable();
  const run = (await app.store.tickSchedule(plannedAt => ({ ...app.engine.prepare(app.playbooks[0], config.limits, { kind: 'scheduled', scheduleId: 'weekday-followup', plannedAt }), ownerPid: 2147483647 }), due))!;
  await app.close();
  app = await createContainer(config);
  expect((await app.store.getRun(run.id)).run.status).toBe('interrupted');
  expect(await app.tickSchedule('2026-11-10T01:00:30.000Z')).toBeUndefined();
  expect(await app.store.listRuns()).toHaveLength(1);
});

it('preserves run limits and does not retry failed scheduled work', async () => {
  await enable();
  app.config.limits.maxCalls = 1;
  const run = (await app.tickSchedule(due))!;
  const failed = await app.wait(run.id);
  expect(failed.run.status).toBe('failed');
  expect(failed.run.error).toBe('CALL_LIMIT');
  expect(failed.run.usage.modelCalls).toBe(1);
  expect(await app.tickSchedule('2026-11-10T01:00:30.000Z')).toBeUndefined();
});

it('pauses future triggers, persists the setting, and resumes at the next future slot', async () => {
  await enable();
  await app.store.setScheduleEnabled(false, 2, before);
  await app.close();
  app = await createContainer(config);
  expect(await app.tickSchedule(due)).toBeUndefined();
  const resumed = await app.store.setScheduleEnabled(true, 3, '2026-11-10T01:00:30.000Z');
  expect(resumed.nextRunAt).toBe('2026-11-11T01:00:00.000Z');
  await expect(app.store.setScheduleEnabled(false, 3)).rejects.toThrow('SCHEDULE_VERSION_CONFLICT');
});

it('records creation failure once without retrying the same occurrence', async () => {
  await enable();
  await app.store.tickSchedule(() => { throw new Error('synthetic-private-failure'); }, due);
  expect((await app.store.getSchedule()).occurrences[0]).toMatchObject({ outcome: 'failed', reason: 'TRIGGER_FAILED' });
  expect(JSON.stringify(await app.store.getSchedule())).not.toContain('synthetic-private');
  expect(await app.tickSchedule(due)).toBeUndefined();
});

it('deduplicates two concurrent tick processes without a web server and leaves persisted approvals', async () => {
  await enable();
  // Seed a due occurrence at the current minute in this isolated fixture only.
  const { schedule } = await app.store.getSchedule();
  schedule.nextRunAt = new Date().toISOString();
  await app.store.client.execute({ sql: 'UPDATE schedules SET payload = ? WHERE id = ?', args: [JSON.stringify(schedule), schedule.id] });
  const execute = () => promisify(execFile)(process.execPath, ['src/cli/schedule-tick.ts'], { cwd: config.root, env: { PATH: process.env.PATH, MODEL_MODE: 'stub', DB_URL: config.dbUrl, MAX_USERS_PER_RUN: '1' }, timeout: 20_000 });
  const results = await Promise.all([execute(), execute()]);
  const output = results.filter(result => result.stdout.trim());
  expect(output).toHaveLength(1);
  const result = JSON.parse(output[0].stdout);
  expect(result.status).toBe('waiting_approval');
  expect(await app.store.listRuns()).toHaveLength(1);
  expect((await app.store.listRuns())[0].trigger?.kind).toBe('scheduled');
  // CLI output goes to its project's out/ by design; clean only this fixture's files.
  const detail = await app.store.getRun(result.runId);
  for (const draft of detail.drafts) await rm(join(config.root, 'out/drafts', `${draft.id}.json`), { force: true });
});

it('renders a launchd interval runner without secrets, shell interpolation or wake catch-up', () => {
  const plist = launchdPlist({ root: '/tmp/a & b', dbUrl: 'file:/tmp/test.db' }, '/tmp/node executable');
  expect(plist).toContain('<key>StartInterval</key><integer>30</integer>');
  expect(plist).toContain('/tmp/a &amp; b');
  expect(plist).not.toContain('StartCalendarInterval');
  expect(plist).not.toContain('KeepAlive');
  expect(plist).not.toContain('API_KEY');
  expect(plist).not.toContain('/bin/sh');
});
