import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { SqliteRecordStore } from '../adapters/sqlite/store.ts';
import { FileMailer, MockUserSource, StubModel, loadMockUsers } from '../adapters/mock/index.ts';
import { FollowupEngine } from '../core/engine.ts';
import { SendService } from '../core/send/service.ts';
import { AppError } from '../core/domain/index.ts';
import type { ReviewInput, RunRecord } from '../core/domain/index.ts';
import { getPlaybook } from '../core/playbook/index.ts';
import { loadPlaybooks } from './playbooks.ts';
import { createDailyFollowup } from '../mastra/workflows/daily-followup.ts';
import { readEnv } from './env.ts';
import type { AppConfig } from './env.ts';

export async function createContainer(config: AppConfig = readEnv()) {
  await mkdir(dirname(config.dbUrl.slice(5)), { recursive: true });
  const store = new SqliteRecordStore(config.dbUrl);
  await store.init(join(config.root, 'db/migrations/001_initial.sql'));
  const playbooks = await loadPlaybooks(join(config.root, 'playbooks'));
  getPlaybook(playbooks, config.playbook);
  const files = new FileMailer(config.outputDirectory);
  const engine = new FollowupEngine({
    store, files, users: new MockUserSource(await loadMockUsers(join(config.root, 'fixtures/users.json'))),
    model: new StubModel(), sender: new SendService(files),
    clock: { now: () => new Date().toISOString(), id: randomUUID, pid: process.pid },
  });
  const workflowStorage = new LibSQLStore({ id: 'followup-workflows', url: config.workflowDbUrl });
  await workflowStorage.init();
  const workflow = createDailyFollowup(engine);
  const mastra = new Mastra({ workflows: { dailyFollowup: workflow }, storage: workflowStorage, logger: false, server: { host: '127.0.0.1' } });
  const tasks = new Map<string, Promise<void>>();
  const alive = (pid: number | null) => {
    if (pid === null) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  for (const run of await store.listRuns()) {
    if (['queued', 'running'].includes(run.status) && !alive(run.ownerPid)) {
      await store.mutate(run.id, detail => {
        if (!['queued', 'running'].includes(detail.run.status) || alive(detail.run.ownerPid)) return;
        detail.run.status = 'interrupted';
        detail.run.ownerPid = null;
        detail.run.error = 'PROCESS_INTERRUPTED';
        detail.run.finishedAt = new Date().toISOString();
        engine.event(detail, 'PROCESS_INTERRUPTED', 'warning');
      });
    }
  }
  async function execute(run: RunRecord, resume: boolean): Promise<void> {
    try {
      await engine.begin(run.id);
      const handle = await mastra.getWorkflow('dailyFollowup').createRun({ runId: run.workflowRunId });
      const result = resume ? await handle.resume({ step: 'review', resumeData: { reviewed: true } }) : await handle.start({ inputData: { runId: run.id } });
      if (result.status === 'success' || result.status === 'suspended') await engine.settle(run.id, result.status === 'suspended');
      else {
        const code = result.status === 'failed' ? result.error.message : 'WORKFLOW_FAILED';
        await engine.fail(run.id, /^[A-Z_]+$/.test(code) ? code : 'STEP_FAILED');
      }
    } catch (error) { await engine.fail(run.id, error instanceof AppError ? error.code : 'WORKFLOW_FAILED'); }
  }
  function launch(run: RunRecord, resume = false): void {
    const task = execute(run, resume).catch(() => { console.error('RUN_PERSISTENCE_FAILED'); }).finally(() => {
      if (tasks.get(run.id) === task) tasks.delete(run.id);
    });
    tasks.set(run.id, task);
  }
  return {
    config, store, engine, mastra, playbooks,
    async start(playbookId = config.playbook, maxUsers = config.limits.maxUsers) {
      if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > config.limits.maxUsers) throw new AppError('USER_LIMIT');
      const run = await engine.create(getPlaybook(playbooks, playbookId), { ...config.limits, maxUsers });
      launch(run);
      return run;
    },
    async review(id: string, draftId: string, input: ReviewInput) {
      const detail = await engine.review(id, draftId, input);
      if (detail.run.status === 'queued') launch(detail.run, true);
      return detail;
    },
    async retry(id: string) {
      const detail = await engine.retry(id, config.limits);
      launch(detail.run);
      return detail;
    },
    async wait(id: string) { await tasks.get(id); return store.getRun(id); },
    async close() {
      for (const id of tasks.keys()) { try { await engine.cancel(id); } catch { /* The task may have just completed. */ } }
      await Promise.all(tasks.values());
      store.close();
      await workflowStorage.close();
    },
  };
}
export type AppContainer = Awaited<ReturnType<typeof createContainer>>;
