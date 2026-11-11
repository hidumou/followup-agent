import { AppError } from '../domain/index.ts';
import type { FollowupDetail, FollowupRecord, ReviewInput, RunDetail, RunRecord } from '../domain/index.ts';
import type { RecordStore, ScheduleStore } from '../ports/index.ts';
import { checkDraft } from '../guards/index.ts';
export interface OperatorCommands {
  start(playbookId?: string, maxUsers?: number): Promise<RunRecord>;
  review(runId: string, draftId: string, input: ReviewInput): Promise<RunDetail>;
  retry(id: string): Promise<RunDetail>;
  cancel(id: string): Promise<RunDetail>;
}
export class OperatorService {
  private readonly commands: OperatorCommands;
  private readonly schedules: ScheduleStore;
  constructor(commands: OperatorCommands, schedules: ScheduleStore) {
    this.commands = commands;
    this.schedules = schedules;
  }
  start(playbookId?: string, maxUsers?: number) {
    return this.commands.start(playbookId, maxUsers);
  }
  review(runId: string, draftId: string, input: ReviewInput) {
    return this.commands.review(runId, draftId, input);
  }
  retry(id: string) {
    return this.commands.retry(id);
  }
  cancel(id: string) {
    return this.commands.cancel(id);
  }
  setSchedule(enabled: boolean, version: number) {
    return this.schedules.setScheduleEnabled(enabled, version);
  }
}
export function projectFollowups(detail: RunDetail): FollowupRecord[] {
  const {
    run,
    drafts
  } = detail;
  const users = [...new Set([...(run.userIds ?? []), ...drafts.map(draft => draft.userId)])];
  return users.map(userId => {
    const draft = drafts.find(draft => draft.userId === userId);
    const label = draft?.label ?? run.classifications?.[userId] ?? null;
    let status: FollowupRecord['status'] = draft?.status ?? 'discovered';
    if (!draft || ['pending_approval', 'approved'].includes(draft.status)) {
      if (run.status === 'cancelled') status = 'cancelled';else if (run.status === 'interrupted') status = 'interrupted';else if (run.status === 'failed' && run.currentUserId === userId) status = 'failed';
    }
    return {
      id: `${run.id}:${userId}`,
      runId: run.id,
      userId,
      playbookId: run.playbook.id,
      playbookName: run.playbook.name,
      playbookVersion: draft?.playbookVersion ?? run.playbook.version ?? null,
      status,
      label,
      labelName: draft?.labelName ?? run.playbook.labels.find(item => item.id === label)?.name ?? null,
      confidence: null,
      discoveredAt: run.createdAt,
      draftedAt: draft?.createdAt ?? null,
      updatedAt: draft?.updatedAt ?? run.updatedAt,
      dryRun: true
    };
  });
}
export interface FollowupFilters {
  status?: string;
  label?: string;
  playbook?: string;
  version?: string;
  query?: string;
  days?: number;
  page?: number;
  sort?: 'newest' | 'oldest';
}
export class ConsoleQueryService {
  private readonly store: RecordStore;
  private readonly day: (iso: string) => string;
  constructor(store: RecordStore, day: (iso: string) => string) {
    this.store = store;
    this.day = day;
  }
  listRuns() {
    return this.store.listRuns();
  }
  async previewDraft(runId: string, draft: {
    subject: string;
    body: string;
  }) {
    const {
      run
    } = await this.store.getRun(runId);
    return {
      errors: checkDraft(draft, run.playbook)
    };
  }
  async getRun(id: string) {
    return {
      ...(await this.store.getRun(id)),
      audit: await this.store.listAudit(id)
    };
  }
  async followups(filters: FollowupFilters = {}) {
    const all = (await this.store.listRunDetails()).flatMap(projectFollowups);
    const cutoff = filters.days ? Date.now() - filters.days * 86400000 : 0;
    const filtered = all.filter(record => (!filters.status || record.status === filters.status) && (!filters.label || record.label === filters.label) && (!filters.playbook || record.playbookId === filters.playbook) && (!filters.version || String(record.playbookVersion ?? 'legacy') === filters.version) && (!filters.query || record.userId.includes(filters.query)) && Date.parse(record.discoveredAt) >= cutoff).sort((a, b) => (filters.sort === 'oldest' ? 1 : -1) * a.discoveredAt.localeCompare(b.discoveredAt) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(filtered.length / 25));
    const page = Math.min(Math.max(1, filters.page ?? 1), pages);
    return {
      records: filtered.slice((page - 1) * 25, page * 25),
      total: filtered.length,
      page,
      pages,
      versions: [...new Set(all.map(item => item.playbookVersion))]
    };
  }
  async followup(id: string): Promise<FollowupDetail> {
    const split = id.indexOf(':');
    if (split < 0) throw new AppError('FOLLOWUP_NOT_FOUND', 404);
    const detail = await this.store.getRun(id.slice(0, split));
    const followup = projectFollowups(detail).find(record => record.id === id);
    if (!followup) throw new AppError('FOLLOWUP_NOT_FOUND', 404);
    const draft = detail.drafts.find(item => item.userId === followup.userId) ?? null;
    return {
      followup,
      run: detail.run,
      draft,
      context: detail.run.contexts?.[followup.userId] ?? null,
      events: detail.events.filter(event => !event.userId || event.userId === followup.userId),
      edits: detail.edits.filter(edit => edit.draftId === draft?.id)
    };
  }
  async overview() {
    const details = await this.store.listRunDetails();
    const today = this.day(new Date().toISOString());
    const inToday = (iso: string) => this.day(iso) === today;
    const followups = details.flatMap(projectFollowups);
    const allDrafts = details.flatMap(detail => detail.drafts);
    const calls = details.flatMap(detail => detail.run.calls ?? []).filter(call => call.day === today);
    return {
      today,
      discovered: followups.filter(item => inToday(item.discoveredAt)).length,
      drafted: allDrafts.filter(item => inToday(item.createdAt)).length,
      pending: allDrafts.filter(item => item.status === 'pending_approval').length,
      simulated: allDrafts.filter(item => item.status === 'simulated' && inToday(item.updatedAt)).length,
      reviewable: details.filter(detail => detail.run.status === 'waiting_approval').flatMap(detail => detail.drafts).filter(draft => draft.status === 'pending_approval').length,
      tokens: calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0),
      costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
      totalCostUsd: await this.store.totalCostUsd(),
      recent: details.slice(0, 5).map(detail => detail.run),
      exceptions: details.map(detail => detail.run).filter(run => ['failed', 'interrupted'].includes(run.status)).slice(0, 10)
    };
  }
  async approvalQueue() {
    return (await this.store.listRunDetails()).filter(detail => detail.run.status === 'waiting_approval').flatMap(detail => detail.drafts.filter(draft => draft.status === 'pending_approval').map(draft => ({
      draft,
      run: detail.run
    })));
  }
}
