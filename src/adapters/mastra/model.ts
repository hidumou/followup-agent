import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { AppError } from '../../core/domain/index.ts';
import type { ModelInfo, ModelPlan, Playbook, UserContext } from '../../core/domain/index.ts';
import type { DraftModel, ModelCallOptions } from '../../core/ports/index.ts';
import { anonymousContext } from '../../core/privacy/index.ts';

interface ModelConfig { fast: 'openai/gpt-6-luna'; writer: 'openai/gpt-6-luna'; apiKey?: string }
type Task = 'classify' | 'draft';
const classificationSchema = (playbook: Playbook) => z.object({ label: z.enum(playbook.labels.map(label => label.id) as [string, ...string[]]) });
const draftSchema = z.object({ subject: z.string(), body: z.string() });

export class MastraDraftModel implements DraftModel {
  readonly mode = 'llm' as const;
  readonly info: ModelInfo;
  private config: ModelConfig;
  private endpoint?: string;
  constructor(config: ModelConfig, endpoint?: string) {
    this.config = config;
    this.info = { mode: 'llm', fast: config.fast, writer: config.writer };
    // The endpoint override is for local contract tests, never a client-supplied URL.
    if (endpoint && !/^http:\/\/127\.0\.0\.1:\d+\//.test(endpoint)) throw new AppError('INVALID_TEST_ENDPOINT');
    this.endpoint = endpoint;
  }
  private request(task: Task, context: UserContext, playbook: Playbook, label?: string) {
    if (!playbook.ai) throw new AppError('PLAYBOOK_AI_MISSING');
    const safeContext = anonymousContext(context, playbook.allowedFeatures);
    const instructions = task === 'classify' ? playbook.ai.classifyInstructions : playbook.ai.draftInstructions;
    const schema = task === 'classify' ? classificationSchema(playbook) : draftSchema;
    const prompt = JSON.stringify({ context: safeContext, selectedLabel: label, business: { name: playbook.name, description: playbook.description, goal: playbook.goal, labels: playbook.labels, rules: playbook.rules } });
    return { instructions, schema, prompt };
  }
  plan(task: Task, context: UserContext, playbook: Playbook, label?: string): ModelPlan {
    const request = this.request(task, context, playbook, label);
    // UTF-8 bytes plus protocol headroom deliberately overestimate short text input.
    const inputTokens = Buffer.byteLength(JSON.stringify({ instructions: request.instructions, prompt: request.prompt, schema: z.toJSONSchema(request.schema) })) + 4096;
    if (inputTokens > 32000) throw new AppError('MODEL_INPUT_TOO_LARGE');
    return { model: task === 'classify' ? this.config.fast : this.config.writer, inputTokens, outputTokens: task === 'classify' ? 256 : 2048, inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.50 };
  }
  private async generate(task: Task, context: UserContext, playbook: Playbook, call: ModelCallOptions | undefined, label?: string): Promise<unknown> {
    if (!call) throw new AppError('MODEL_BUDGET_REQUIRED');
    call.signal.throwIfAborted();
    const { instructions, schema, prompt } = this.request(task, context, playbook, label);
    const plan = this.plan(task, context, playbook, label);
    const agent = new Agent({
      id: `followup-${task}`, name: `Followup ${task}`, instructions,
      model: { id: plan.model as 'openai/gpt-6-luna', apiKey: this.config.apiKey, api: 'responses', ...(this.endpoint ? { url: this.endpoint } : {}) },
      maxRetries: 0,
    });
    // Disable raw SDK logs and message persistence; expose only sanitized run events.
    const runtime = new Mastra({ agents: { task: agent }, logger: false });
    try {
      const result = await runtime.getAgent('task').generate<{ label: string } | { subject: string; body: string }>(prompt, {
        maxSteps: 1, maxProcessorRetries: 0, abortSignal: call.signal,
        modelSettings: { maxOutputTokens: plan.outputTokens, maxRetries: 0 },
        providerOptions: { openai: { reasoningEffort: 'none', store: false, serviceTier: 'default', transport: 'fetch' } },
        structuredOutput: { schema, errorStrategy: 'strict' },
      });
      const usage = result.totalUsage;
      if (usage?.inputTokens === undefined || usage.outputTokens === undefined) throw new AppError('MODEL_USAGE_MISSING');
      await call.reportUsage({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      if (result.finishReason !== 'stop') throw new AppError(result.finishReason === 'length' ? 'MODEL_OUTPUT_LIMIT' : 'MODEL_OUTPUT_INVALID');
      const parsed = schema.safeParse(result.object);
      if (!parsed.success) throw new AppError('MODEL_OUTPUT_INVALID');
      return parsed.data;
    } catch (error) {
      if (call.signal.aborted) throw call.signal.reason;
      if (error instanceof AppError) throw error;
      // Never persist provider bodies, headers, prompts, or exception messages.
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
      throw new AppError(status === 401 || status === 403 ? 'MODEL_AUTH_FAILED' : status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_REQUEST_FAILED');
    }
  }
  async classify(context: UserContext, playbook: Playbook, call?: ModelCallOptions): Promise<string> {
    return classificationSchema(playbook).parse(await this.generate('classify', context, playbook, call)).label;
  }
  async draft(context: UserContext, label: string, playbook: Playbook, call?: ModelCallOptions): Promise<{ subject: string; body: string }> {
    return draftSchema.parse(await this.generate('draft', context, playbook, call, label));
  }
}
