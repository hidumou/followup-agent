import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AppError } from '../../core/domain/index.ts';
import type { UserContext } from '../../core/domain/index.ts';
import { anonymousContext } from '../../core/privacy/index.ts';

export async function probeReadOnlyTool(options: {
  model: 'openai/gpt-6-luna'; apiKey?: string; context: UserContext; signal: AbortSignal;
  beforeCall(): Promise<void>;
  reportUsage(usage: { inputTokens: number; outputTokens: number }): Promise<void>;
}) {
  const context = anonymousContext(options.context, ['sessions', 'completedActions']);
  let executions = 0;
  const lookupAnonymousFeatures = createTool({
    id: 'lookup-anonymous-features', description: 'Read the numeric activity metrics for one opaque user ID.',
    inputSchema: z.object({ userId: z.string() }),
    outputSchema: z.object({ sessions: z.number(), completedActions: z.number() }),
    execute: async input => {
      if (input.userId !== context.userId || executions !== 0) throw new AppError('INVALID_PROBE_TOOL_CALL');
      executions++;
      return { sessions: Number(context.features.sessions), completedActions: Number(context.features.completedActions) };
    },
  });
  const agent = new Agent({
    id: 'read-only-tool-validation', name: 'Read-only tool validation', maxRetries: 0,
    instructions: 'Call lookupAnonymousFeatures exactly once for the supplied user ID. Then use the returned numbers to calculate sessions + completedActions. Reply only with a JSON object containing the numeric field total. Do not guess the numbers.',
    model: { id: options.model, apiKey: options.apiKey, api: 'responses' }, tools: { lookupAnonymousFeatures },
  });
  const runtime = new Mastra({ agents: { probe: agent }, logger: false });
  try {
    const result = await runtime.getAgent('probe').generate(`User ID: ${context.userId}`, {
      maxSteps: 2, maxProcessorRetries: 0, abortSignal: options.signal,
      modelSettings: { maxOutputTokens: 256, maxRetries: 0 },
      providerOptions: { openai: { reasoningEffort: 'none', store: false, serviceTier: 'default', transport: 'fetch' } },
      prepareStep: async () => { await options.beforeCall(); },
      onStepFinish: async ({ usage }) => {
        if (usage.inputTokens === undefined || usage.outputTokens === undefined) throw new AppError('MODEL_USAGE_MISSING');
        await options.reportUsage({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      },
    });
    const answer = z.object({ total: z.number() }).safeParse(JSON.parse(result.text));
    if (result.finishReason !== 'stop' || executions !== 1 || !answer.success || answer.data.total !== Number(context.features.sessions) + Number(context.features.completedActions)) throw new AppError('TOOL_PROBE_FAILED');
    return { executions, total: answer.data.total, steps: result.steps.length, usage: result.totalUsage };
  } catch (error) {
    if (options.signal.aborted) throw new AppError('MODEL_TIMEOUT');
    if (error instanceof AppError) throw error;
    throw new AppError('TOOL_PROBE_FAILED');
  }
}
