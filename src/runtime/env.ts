import { z } from 'zod';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const schema = z.object({
  ADAPTER_PROFILE: z.literal('mock').default('mock'),
  PLAYBOOK: z.string().regex(/^[a-z][a-z0-9-]*$/).default('demo'),
  SEND_MODE: z.literal('dry-run').default('dry-run'),
  MODEL_MODE: z.enum(['stub', 'openai']).default('stub'),
  MODEL_FAST: z.preprocess(value => value === '' ? undefined : value, z.literal('openai/gpt-6-luna').default('openai/gpt-6-luna')),
  MODEL_WRITER: z.preprocess(value => value === '' ? undefined : value, z.literal('openai/gpt-6-luna').default('openai/gpt-6-luna')),
  OPENAI_API_KEY: z.string().optional(),
  LLM_BUDGET_USD: z.coerce.number().finite().min(0).max(100).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  BUDGET_TIMEZONE: z.string().default('Asia/Taipei').refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  DB_URL: z.string().regex(/^file:/).default('file:./data/followup.db'),
  MAX_USERS_PER_RUN: z.coerce.number().int().min(1).max(100).default(10),
  MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().min(1).max(1000).default(30),
  DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(100000),
  CONSOLE_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  CONSOLE_PORT: z.coerce.number().int().min(1024).max(65535).optional(),
  UI_PORT: z.coerce.number().int().min(1024).max(65535).default(4180),
});
export interface AppConfig {
  root: string; dbUrl: string; workflowDbUrl: string; outputDirectory: string;
  playbook: string; port: number; limits: { maxUsers: number; maxCalls: number; dailyTokens: number };
  model: { mode: 'stub' | 'openai'; fast: 'openai/gpt-6-luna'; writer: 'openai/gpt-6-luna'; apiKey?: string; budgetUsd: number; timeoutMs: number; timezone: string };
}
export function resolveProjectRoot(start = process.cwd()): string {
  let directory = resolve(start);
  while (true) {
    if (existsSync(join(directory, 'package.json')) && existsSync(join(directory, 'db/migrations/001_initial.sql'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Followup project root not found');
    directory = parent;
  }
}
export function readEnv(root = resolveProjectRoot(), source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const env = parsed.data;
  if (env.MODEL_MODE === 'openai' && !env.OPENAI_API_KEY?.trim()) throw new Error('Invalid environment: OPENAI_API_KEY');
  const dbPath = resolve(root, env.DB_URL.slice(5));
  return {
    root, dbUrl: `file:${dbPath}`, workflowDbUrl: `file:${dbPath}.workflow.db`, outputDirectory: resolve(root, 'out'),
    playbook: env.PLAYBOOK, port: env.CONSOLE_PORT ?? env.UI_PORT,
    model: { mode: env.MODEL_MODE, fast: env.MODEL_FAST, writer: env.MODEL_WRITER, apiKey: env.OPENAI_API_KEY, budgetUsd: env.LLM_BUDGET_USD, timeoutMs: env.LLM_TIMEOUT_MS, timezone: env.BUDGET_TIMEZONE },
    limits: { maxUsers: env.MAX_USERS_PER_RUN, maxCalls: env.MAX_LLM_CALLS_PER_RUN, dailyTokens: env.DAILY_TOKEN_BUDGET },
  };
}
