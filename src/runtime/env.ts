import { z } from 'zod';
import { resolve } from 'node:path';

const schema = z.object({
  ADAPTER_PROFILE: z.literal('mock').default('mock'),
  PLAYBOOK: z.string().regex(/^[a-z][a-z0-9-]*$/).default('demo'),
  SEND_MODE: z.literal('dry-run').default('dry-run'),
  DB_URL: z.string().regex(/^file:/).default('file:./data/followup.db'),
  MAX_USERS_PER_RUN: z.coerce.number().int().min(1).max(100).default(10),
  MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().min(1).max(1000).default(30),
  DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(100000),
  UI_PORT: z.coerce.number().int().min(1024).max(65535).default(4180),
});
export interface AppConfig {
  root: string; dbUrl: string; workflowDbUrl: string; outputDirectory: string;
  playbook: string; port: number; limits: { maxUsers: number; maxCalls: number; dailyTokens: number };
}
export function readEnv(root = process.cwd(), source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const env = parsed.data;
  const dbPath = resolve(root, env.DB_URL.slice(5));
  return {
    root, dbUrl: `file:${dbPath}`, workflowDbUrl: `file:${dbPath}.workflow.db`, outputDirectory: resolve(root, 'out'),
    playbook: env.PLAYBOOK, port: env.UI_PORT,
    limits: { maxUsers: env.MAX_USERS_PER_RUN, maxCalls: env.MAX_LLM_CALLS_PER_RUN, dailyTokens: env.DAILY_TOKEN_BUDGET },
  };
}
