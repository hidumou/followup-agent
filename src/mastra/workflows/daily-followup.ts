import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { FollowupEngine } from '../../core/engine.ts';

export function createDailyFollowup(engine: FollowupEngine) {
  const schema = z.object({ runId: z.string() });
  const discover = createStep({
    id: 'discover', inputSchema: schema, outputSchema: schema, retries: 0,
    execute: async ({ inputData }) => { await engine.discover(inputData.runId); return inputData; },
  });
  const generate = createStep({
    id: 'generate-drafts', inputSchema: schema, outputSchema: schema, retries: 0,
    execute: async ({ inputData }) => { await engine.generate(inputData.runId); return inputData; },
  });
  const review = createStep({
    id: 'review', inputSchema: schema, outputSchema: schema, retries: 0,
    resumeSchema: z.object({ reviewed: z.literal(true) }), suspendSchema: z.object({ pending: z.number() }),
    execute: async ({ inputData, suspend }) => {
      const detail = await engine.checkpoint(inputData.runId, 'review');
      const pending = detail.drafts.filter(draft => draft.status === 'pending_approval').length;
      if (pending) await suspend({ pending });
      return inputData;
    },
  });
  const send = createStep({
    id: 'simulate-send', inputSchema: schema, outputSchema: schema, retries: 0,
    execute: async ({ inputData }) => { await engine.send(inputData.runId); return inputData; },
  });
  return createWorkflow({
    id: 'daily-followup', inputSchema: schema, outputSchema: schema,
    options: { autoRestartActiveRuns: false },
  }).then(discover).then(generate).then(review).then(send).commit();
}
