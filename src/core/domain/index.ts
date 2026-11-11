export type RunStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type StepId = 'discover' | 'context' | 'classify' | 'draft' | 'guard' | 'review' | 'send' | 'done';
export type DraftStatus = 'pending_approval' | 'approved' | 'rejected' | 'simulated';
export interface UserRef { userId: string }
export interface UserContext extends UserRef { features: Record<string, number | boolean> }
export interface Contact { email: string; name?: string }
export interface Label { id: string; name: string; feature?: string; lessThan?: number; subject: string; body: string }
export interface Playbook {
  id: string; name: string; description: string; goal: string;
  allowedFeatures: string[]; labels: Label[];
  ai?: { classifyInstructions: string; draftInstructions: string };
  rules: { minLength: number; maxLength: number; requiredText: string; forbiddenPhrases: string[] };
}
export interface Limits { maxUsers: number; maxCalls: number; dailyTokens: number }
export interface Usage { modelCalls: number; llmCalls: number; inputTokens: number; outputTokens: number }
export interface ModelPlan { model: string; inputTokens: number; outputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number }
export interface ModelCall extends ModelPlan { id: string; day: string; state: 'reserved' | 'reported' | 'unknown'; costUsd: number }
export interface ModelInfo { mode: 'stub' | 'llm'; fast: string; writer: string }
export interface RunRecord {
  id: string; status: RunStatus; step: StepId; playbook: Playbook; limits: Limits; usage: Usage;
  createdAt: string; updatedAt: string; finishedAt?: string; ownerPid: number | null;
  attempt: number; workflowRunId: string; userIds: string[] | null; processed: number; skipped: number;
  currentUserId?: string; error?: string; cancelRequested: boolean;
  model?: ModelInfo; calls?: ModelCall[];
}
export interface Draft {
  id: string; runId: string; userId: string; label: string; labelName: string;
  subject: string; body: string; originalSubject: string; originalBody: string;
  status: DraftStatus; version: number; createdAt: string; updatedAt: string; receiptId?: string;
}
export interface RunEvent { id: string; at: string; kind: 'info' | 'success' | 'warning' | 'error'; code: string; step: StepId; userId?: string }
export interface HumanEdit { id: string; draftId: string; at: string; decision: 'approved' | 'rejected'; before: { subject: string; body: string }; after: { subject: string; body: string } }
export interface RunDetail { run: RunRecord; drafts: Draft[]; events: RunEvent[]; edits: HumanEdit[] }
export interface ReviewInput { version: number; decision: 'approved' | 'rejected'; subject: string; body: string }
export class AppError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.name = 'AppError'; this.code = code; this.status = status; }
}
export const activeStatuses: RunStatus[] = ['queued', 'running', 'waiting_approval'];
export const retryableStatuses: RunStatus[] = ['failed', 'cancelled', 'interrupted'];
