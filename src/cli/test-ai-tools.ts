import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createContainer } from '../runtime/container.ts';
import { readEnv } from '../runtime/env.ts';
import { AppError } from '../core/domain/index.ts';
import { assertBudget, assertCostBudget } from '../core/guards/index.ts';
import { probeReadOnlyTool } from '../adapters/mastra/tool-probe.ts';

async function main() {
  const config = readEnv();
  if (config.model.mode !== 'openai' || config.model.budgetUsd <= 0) throw new AppError('REAL_MODEL_AND_BUDGET_REQUIRED');
  config.dbUrl = `file:${join(config.root, 'data/ai-validation.db')}`;
  config.workflowDbUrl = `${config.dbUrl}.workflow.db`;
  config.model.budgetUsd = Math.min(config.model.budgetUsd, 1);
  config.limits.maxUsers = 1;
  config.limits.maxCalls = Math.min(config.limits.maxCalls, 2);
  const app = await createContainer(config);
  const context = { userId: 'usr_a1b2c3d4e5f6', features: { sessions: 7, completedActions: 4 } };
  const run = await app.engine.create({ ...app.playbooks.find(item => item.id === 'demo')!, name: '只读工具调用验证（测试）' }, config.limits);
  const costBefore = await app.store.totalCostUsd();
  let currentCall: string | undefined;
  let outcome: Awaited<ReturnType<typeof probeReadOnlyTool>> | undefined;
  try {
    await app.engine.begin(run.id);
    await app.store.mutate(run.id, detail => { detail.run.userIds = [context.userId]; });
    await app.engine.checkpoint(run.id, 'classify', context.userId);
    const signal = AbortSignal.timeout(config.model.timeoutMs);
    outcome = await probeReadOnlyTool({
      model: config.model.fast, apiKey: config.model.apiKey, context, signal,
      beforeCall: async () => {
        const day = app.engine.deps.modelBudget!.day(new Date().toISOString());
        const daily = await app.store.dailyTokens(day);
        const plan = { model: config.model.fast, inputTokens: 8192, outputTokens: 256, inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 };
        const costUsd = (plan.inputTokens * plan.inputUsdPerMillion + plan.outputTokens * plan.outputUsdPerMillion) / 1e6;
        assertCostBudget(await app.store.totalCostUsd(), costUsd, config.model.budgetUsd);
        currentCall = randomUUID();
        await app.store.mutate(run.id, detail => {
          assertBudget(detail.run.limits, detail.run.usage, 1, daily, plan.inputTokens + plan.outputTokens);
          detail.run.usage.llmCalls++; detail.run.usage.modelCalls++;
          detail.run.calls!.push({ ...plan, id: currentCall!, day, state: 'reserved', costUsd });
          app.engine.event(detail, 'LLM_CALL_STARTED');
        });
      },
      reportUsage: async usage => {
        if (![usage.inputTokens, usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new AppError('MODEL_USAGE_MISSING');
        await app.store.mutate(run.id, detail => {
          const call = detail.run.calls!.find(item => item.id === currentCall)!;
          if (call.state !== 'reserved') throw new AppError('MODEL_USAGE_DUPLICATE');
          call.state = 'reported'; call.inputTokens = usage.inputTokens; call.outputTokens = usage.outputTokens;
          call.costUsd = (usage.inputTokens * call.inputUsdPerMillion + usage.outputTokens * call.outputUsdPerMillion) / 1e6;
          detail.run.usage.inputTokens += usage.inputTokens; detail.run.usage.outputTokens += usage.outputTokens;
          app.engine.event(detail, 'LLM_USAGE_RECORDED');
        });
        if (usage.inputTokens > 8192 || usage.outputTokens > 256) throw new AppError('MODEL_USAGE_EXCEEDED');
      },
    });
    const detail = await app.store.getRun(run.id);
    if (detail.run.usage.llmCalls !== 2 || detail.run.calls!.some(call => call.state !== 'reported')) throw new AppError('TOOL_PROBE_USAGE_INVALID');
    await app.engine.settle(run.id, false);
  } catch (error) {
    await app.engine.fail(run.id, error instanceof AppError ? error.code : 'TOOL_PROBE_FAILED');
    process.exitCode = 1;
  } finally {
    await app.store.mutate(run.id, detail => { for (const call of detail.run.calls ?? []) if (call.state === 'reserved') call.state = 'unknown'; });
    const detail = await app.store.getRun(run.id);
    const cumulativeCostUsd = await app.store.totalCostUsd();
    const report = { kind: 'read_only_tool_probe', outcome, estimatedCostUsd: cumulativeCostUsd - costBefore, cumulativeCostUsd, detail };
    const directory = join(config.root, 'out/ai-validation/tools');
    await mkdir(directory, { recursive: true });
    const reportPath = join(directory, `${run.id}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: detail.run.status, error: detail.run.error, outcome, estimatedCostUsd: report.estimatedCostUsd, cumulativeCostUsd, reportPath }));
    await app.close();
  }
}
try { await main(); }
catch { console.error('TOOL_PROBE_SETUP_FAILED'); process.exitCode = 1; }
