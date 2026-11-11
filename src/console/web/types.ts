import type { AuditLogEntry, Draft, Limits, ModelInfo, Playbook, RunDetail, RunRecord } from '../../core/domain/index.ts';
import type { ConsoleQueryService } from '../../core/services/index.ts';
import type { ScheduleSnapshot } from '../../core/schedule/index.ts';
import type { RunnerStatus } from '../../adapters/launchd/scheduler.ts';
export interface Config {
  playbooks: Playbook[];
  defaultPlaybook: string;
  limits: Limits;
  model: ModelInfo;
  budgetUsd: number;
  mode: 'dry-run';
}
export type Overview = Awaited<ReturnType<ConsoleQueryService['overview']>>;
export type FollowupList = Awaited<ReturnType<ConsoleQueryService['followups']>>;
export type QueueItem = {
  draft: Draft;
  run: RunRecord;
};
export interface ScheduleData extends ScheduleSnapshot {
  runner: RunnerStatus;
}
export interface WorkspaceData {
  config: Config;
  overview: Overview;
  runs: RunRecord[];
  queue: QueueItem[];
  schedule: ScheduleData;
}
export type RunView = RunDetail & {
  audit: AuditLogEntry[];
};
export type View = 'overview' | 'followups' | 'approvals' | 'playbooks' | 'runs';
