import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createContainer } from '../runtime/container.ts';
import type { AppContainer } from '../runtime/container.ts';
import { readEnv } from '../runtime/env.ts';
import { AppError } from '../core/domain/index.ts';
import type { RunDetail } from '../core/domain/index.ts';
import { MockUserSource, loadMockUsers } from '../adapters/mock/index.ts';
import { checkDraft } from '../core/guards/index.ts';

function requireCheck(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AppError(code);
}

async function main() {
  const config = readEnv();
  requireCheck(config.model.mode === 'openai', 'REAL_MODEL_REQUIRED');
  requireCheck(config.model.budgetUsd > 0, 'POSITIVE_TEST_BUDGET_REQUIRED');
  requireCheck(config.limits.maxUsers >= 3 && config.limits.maxCalls >= 6, 'TEST_REQUIRES_THREE_USERS_SIX_CALLS');
  const batch = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(3).toString('hex')}`;
  // Keep one ledger across invocations; never reset cumulative spending on retry.
  config.dbUrl = `file:${join(config.root, 'data/ai-validation.db')}`;
  config.workflowDbUrl = `${config.dbUrl}.workflow.db`;
  config.outputDirectory = join(config.root, 'out/ai-validation', batch);
  config.model.budgetUsd = Math.min(config.model.budgetUsd, 1);
  config.limits.maxUsers = 3;
  config.limits.maxCalls = 6;
  const cases = JSON.parse(await readFile(join(config.root, 'fixtures/ai-validation.json'), 'utf8')) as { playbook: string; expectedLabels: string[] }[];
  // Different synthetic opaque IDs make repeated batches testable without erasing history.
  const users = (await loadMockUsers(join(config.root, 'fixtures/users.json'))).slice(0, 3).map(user => ({ ...user, userId: `usr_${randomBytes(6).toString('hex')}` }));
  let app: AppContainer = await createContainer(config);
  const results: RunDetail[] = [];
  const runIds: string[] = [];
  const startedAt = new Date().toISOString();
  const costBefore = await app.store.totalCostUsd();
  let status = 'failed';
  let errorCode: string | undefined;
  let contactCalls = 0;
  function attachUsers() {
    app.engine.deps.users = new MockUserSource(users);
    app.engine.deps.users.getContact = async () => { contactCalls++; throw new AppError('CONTACT_MUST_NOT_BE_FETCHED'); };
  }
  attachUsers();
  try {
    for (const scenario of cases) {
      console.log(JSON.stringify({ phase: 'generating', playbook: scenario.playbook, users: 3, callLimit: 6, budgetUsd: config.model.budgetUsd }));
      const run = await app.start(scenario.playbook, 3);
      runIds.push(run.id);
      const waiting = await app.wait(run.id);
      requireCheck(waiting.run.status === 'waiting_approval', waiting.run.error ?? 'REVIEW_NOT_REACHED');
      requireCheck(waiting.drafts.length === 3, 'DRAFT_COUNT_MISMATCH');
      requireCheck(waiting.run.usage.llmCalls === 6 && waiting.run.calls?.length === 6, 'REAL_CALL_COUNT_MISMATCH');
      requireCheck(waiting.run.calls.every(call => call.state === 'reported'), 'UNCONFIRMED_USAGE');
      requireCheck(waiting.run.usage.inputTokens > 0 && waiting.run.usage.outputTokens > 0, 'EMPTY_REAL_USAGE');
      for (const [index, user] of users.entries()) {
        const draft = waiting.drafts.find(item => item.userId === user.userId);
        requireCheck(draft, 'DRAFT_MISSING');
        requireCheck(draft.label === scenario.expectedLabels[index], 'CLASSIFICATION_MISMATCH');
        requireCheck(checkDraft(draft, waiting.run.playbook).length === 0, 'GUARD_REJECTED');
        requireCheck(draft.status === 'pending_approval' && !draft.receiptId, 'PREMATURE_SEND');
      }
      await app.close();
      app = await createContainer(config);
      attachUsers();
      const reopened = await app.store.getRun(run.id);
      requireCheck(reopened.run.status === 'waiting_approval', 'RESTART_LOST_APPROVAL');
      requireCheck(reopened.run.usage.llmCalls === 6, 'RESTART_CHANGED_USAGE');
      // Exercise review actions only in this dedicated dry-run test database.
      for (const [index, draft] of reopened.drafts.entries()) {
        await app.review(run.id, draft.id, {
          version: draft.version, decision: index === 1 ? 'rejected' : 'approved',
          subject: index === 0 ? `${draft.subject.slice(0, 150)}（回访）` : draft.subject, body: draft.body,
        });
      }
      const complete = await app.wait(run.id);
      requireCheck(complete.run.status === 'completed', complete.run.error ?? 'RUN_NOT_COMPLETED');
      requireCheck(complete.drafts.filter(draft => draft.status === 'simulated').length === 2, 'SIMULATED_SEND_COUNT');
      requireCheck(complete.drafts.filter(draft => draft.status === 'rejected').length === 1, 'REJECTION_COUNT');
      requireCheck(complete.edits.length === 3 && complete.edits[0].before.subject !== complete.edits[0].after.subject, 'REVIEW_AUDIT_MISSING');
      requireCheck(complete.run.usage.llmCalls === 6, 'REVIEW_CALLED_MODEL');
      requireCheck(contactCalls === 0, 'CONTACT_PRIVACY_VIOLATION');
      results.push(complete);
      console.log(JSON.stringify({ phase: 'passed', playbook: scenario.playbook, runId: run.id, usage: complete.run.usage }));
    }
    status = 'passed_automated_checks';
  } catch (error) {
    errorCode = error instanceof AppError ? error.code : 'AI_VALIDATION_FAILED';
    process.exitCode = 1;
  } finally {
    for (const id of runIds) {
      if (!results.some(result => result.run.id === id)) results.push(await app.store.getRun(id));
    }
    const cumulativeCostUsd = await app.store.totalCostUsd();
    const report = {
      status, error: errorCode, startedAt, finishedAt: new Date().toISOString(),
      models: { fast: config.model.fast, writer: config.model.writer },
      source: 'synthetic_users', sending: 'dry-run', review: 'scripted_test_actions',
      qualityReview: 'pending_manual_review', budgetUsd: config.model.budgetUsd,
      estimatedCostUsd: cumulativeCostUsd - costBefore, cumulativeCostUsd, contactCalls, results,
    };
    await mkdir(config.outputDirectory, { recursive: true });
    const reportPath = join(config.outputDirectory, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status, error: errorCode, estimatedCostUsd: report.estimatedCostUsd, cumulativeCostUsd, reportPath }));
    await app.close();
  }
}

try { await main(); }
catch (error) {
  console.error(error instanceof AppError ? error.code : 'AI_VALIDATION_SETUP_FAILED: check local .env credentials and model configuration');
  process.exitCode = 1;
}
