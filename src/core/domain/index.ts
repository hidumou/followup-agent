export type RunStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type StepId = 'discover' | 'context' | 'classify' | 'draft' | 'guard' | 'review' | 'send' | 'done';
export type DraftStatus = 'pending_approval' | 'approved' | 'rejected' | 'simulated';
export interface UserRef { userId: string }
export interface UserContext extends UserRef { features: Record<string, number | boolean> }
export interface Contact { email: string; name?: string }
export interface Label { id: string; name: string; feature?: string; lessThan?: number; subject: string; body: string }
export interface Playbook {
  id: string; name: string; description: string; goal: string;
  version?: number;
  allowedFeatures: string[]; labels: Label[];
  ai?: { classifyInstructions: string; draftInstructions: string };
  rules: { minLength: number; maxLength: number; requiredText: string; forbiddenPhrases: string[] };
}
export interface Limits { maxUsers: number; maxCalls: number; dailyTokens: number }
export interface Usage { modelCalls: number; llmCalls: number; inputTokens: number; outputTokens: number }
export interface ModelPlan { model: string; inputTokens: number; outputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number }
export interface ModelCall extends ModelPlan { id: string; day: string; state: 'reserved' | 'reported' | 'unknown'; costUsd: number }
export interface ModelInfo { mode: 'stub' | 'llm'; fast: string; writer: string }
export type RunTrigger = { kind: 'manual' } | { kind: 'scheduled'; scheduleId: string; plannedAt: string };
export interface RunRecord {
  id: string; status: RunStatus; step: StepId; playbook: Playbook; limits: Limits; usage: Usage;
  createdAt: string; updatedAt: string; finishedAt?: string; ownerPid: number | null;
  attempt: number; workflowRunId: string; userIds: string[] | null; processed: number; skipped: number;
  currentUserId?: string; error?: string; cancelRequested: boolean;
  model?: ModelInfo; calls?: ModelCall[];
  trigger?: RunTrigger;
  contexts?: Record<string, UserContext>;
  classifications?: Record<string, string>;
}
export interface Draft {
  id: string; runId: string; userId: string; label: string; labelName: string;
  subject: string; body: string; originalSubject: string; originalBody: string;
  status: DraftStatus; version: number; createdAt: string; updatedAt: string; receiptId?: string;
  playbookVersion?: number;
}
export interface RunEvent { id: string; at: string; kind: 'info' | 'success' | 'warning' | 'error'; code: string; step: StepId; userId?: string }
export interface HumanEdit { id: string; draftId: string; at: string; decision: 'approved' | 'rejected'; before: { subject: string; body: string }; after: { subject: string; body: string } }
export interface RunDetail { run: RunRecord; drafts: Draft[]; events: RunEvent[]; edits: HumanEdit[] }
export interface AuditContext { actor: 'operator' | 'system'; action: string; objectType?: 'run' | 'draft' | 'schedule'; objectId?: string }
export interface AuditLogEntry extends AuditContext {
  id: string; at: string; runId: string | null; playbookVersion: number | null;
  before: Record<string, string | number | boolean | null>; after: Record<string, string | number | boolean | null>;
}
export interface FollowupRecord {
  id: string; runId: string; userId: string; playbookId: string; playbookName: string; playbookVersion: number | null;
  status: DraftStatus | 'discovered' | 'failed' | 'cancelled' | 'interrupted';
  label: string | null; labelName: string | null; confidence: number | null;
  discoveredAt: string; draftedAt: string | null; updatedAt: string; dryRun: true;
}
export interface FollowupDetail { followup: FollowupRecord; context: UserContext | null; draft: Draft | null; events: RunEvent[]; edits: HumanEdit[]; run: RunRecord }
export interface ReviewInput { version: number; decision: 'approved' | 'rejected'; subject: string; body: string }
export class AppError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.name = 'AppError'; this.code = code; this.status = status; }
}
export const activeStatuses: RunStatus[] = ['queued', 'running', 'waiting_approval'];
export const retryableStatuses: RunStatus[] = ['failed', 'cancelled', 'interrupted'];
