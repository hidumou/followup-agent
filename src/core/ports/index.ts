import type { Contact, Draft, ModelInfo, ModelPlan, Playbook, RunDetail, RunRecord, UserContext, UserRef } from '../domain/index.ts';

export interface UserSource {
  listChurned(options: { limit: number }): Promise<UserRef[]>;
  getContext(userId: string): Promise<UserContext>;
  getContact(userId: string): Promise<Contact>;
}
export interface DraftModel {
  readonly mode: 'stub' | 'llm';
  readonly info?: ModelInfo;
  plan?(task: 'classify' | 'draft', context: UserContext, playbook: Playbook, label?: string): ModelPlan;
  classify(context: UserContext, playbook: Playbook, call?: ModelCallOptions): Promise<string>;
  draft(context: UserContext, label: string, playbook: Playbook, call?: ModelCallOptions): Promise<{ subject: string; body: string }>;
}
export interface ModelCallOptions { signal: AbortSignal; reportUsage(usage: { inputTokens: number; outputTokens: number }): Promise<void> }
export interface RecordStore {
  createRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunDetail>;
  listRuns(): Promise<RunRecord[]>;
  mutate(id: string, change: (detail: RunDetail) => void): Promise<RunDetail>;
  reservedUsers(playbook: string, exceptRun?: string): Promise<Set<string>>;
  dailyTokens(day: string): Promise<number>;
  totalCostUsd(): Promise<number>;
}
export interface DraftFiles {
  saveDraft(draft: Draft): Promise<void>;
}
export interface Mailer {
  simulate(draft: Draft): Promise<{ receiptId: string }>;
}
export interface RuntimeClock { now(): string; id(): string; pid: number }
