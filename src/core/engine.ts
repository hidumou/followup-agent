import { AppError, activeStatuses, retryableStatuses } from './domain/index.ts';
import type { Limits, ModelPlan, Playbook, ReviewInput, RunDetail, RunRecord, RunTrigger, StepId, UserContext } from './domain/index.ts';
import type { DraftFiles, DraftModel, ModelCallOptions, RecordStore, RuntimeClock, UserSource } from './ports/index.ts';
import { anonymousContext } from './privacy/index.ts';
import { assertBudget, assertCostBudget, checkDraft } from './guards/index.ts';
import { SendService } from './send/service.ts';

export interface EngineDependencies {
  store: RecordStore; users: UserSource; model: DraftModel; files: DraftFiles; sender: SendService; clock: RuntimeClock;
  modelBudget?: { totalUsd: number; timeoutMs: number; day(iso: string): string };
}

export class FollowupEngine {
  readonly deps: EngineDependencies;
  private inFlight = new Map<string, AbortController>();
  constructor(deps: EngineDependencies) { this.deps = deps; }
  event(detail: RunDetail, code: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const { clock } = this.deps;
    detail.run.updatedAt = clock.now();
    detail.events.push({ id: clock.id(), at: clock.now(), code, kind, step: detail.run.step, userId: detail.run.currentUserId });
  }
  prepare(playbook: Playbook, limits: Limits, trigger: RunTrigger = { kind: 'manual' }): RunRecord {
    const { clock } = this.deps;
    const id = clock.id();
    const run: RunRecord = {
      id, status: 'queued', step: 'discover', playbook, limits, usage: { modelCalls: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0 },
      createdAt: clock.now(), updatedAt: clock.now(), ownerPid: clock.pid, attempt: 1,
      workflowRunId: `${id}-1`, userIds: null, processed: 0, skipped: 0, cancelRequested: false,
      model: this.deps.model.info ?? { mode: 'stub', fast: 'stub', writer: 'stub' }, calls: [], trigger,
    };
    return run;
  }
  async create(playbook: Playbook, limits: Limits): Promise<RunRecord> {
    const run = this.prepare(playbook, limits);
    await this.deps.store.createRun(run, { actor: 'operator', action: 'run.start' });
    await this.deps.store.mutate(run.id, detail => this.event(detail, 'RUN_CREATED'));
    return run;
  }
  async checkpoint(id: string, step?: StepId, userId?: string): Promise<RunDetail> {
    return this.deps.store.mutate(id, detail => {
      if (detail.run.cancelRequested || detail.run.status === 'cancelled') throw new AppError('RUN_CANCELLED', 409);
      if (detail.run.status !== 'running') throw new AppError('RUN_NOT_RUNNING', 409);
      if (step && (detail.run.step !== step || detail.run.currentUserId !== userId)) {
        detail.run.step = step;
        detail.run.currentUserId = userId;
        this.event(detail, 'STEP_STARTED');
      }
    });
  }
  async begin(id: string): Promise<void> {
    await this.deps.store.mutate(id, detail => {
      if (detail.run.status !== 'queued') throw new AppError('RUN_NOT_QUEUED', 409);
      detail.run.status = 'running';
      detail.run.ownerPid = this.deps.clock.pid;
      this.event(detail, 'RUN_STARTED');
    });
  }
  async discover(id: string): Promise<void> {
    const { store, users } = this.deps;
    const detail = await this.checkpoint(id, 'discover');
    if (detail.run.userIds !== null) return;
    const candidates = await users.listChurned({ limit: 1000 });
    const reserved = await store.reservedUsers(detail.run.playbook.id, id);
    const unique = [...new Set(candidates.map(user => user.userId))];
    const selected = unique.filter(userId => !reserved.has(userId)).slice(0, detail.run.limits.maxUsers);
    await this.checkpoint(id);
    await store.mutate(id, current => {
      current.run.userIds = selected;
      current.run.skipped = unique.length - selected.length;
      this.event(current, 'USERS_SELECTED', 'success');
    });
  }
  private async reserveCall(id: string, plan?: ModelPlan): Promise<string> {
    const { store, clock } = this.deps;
    const day = this.deps.modelBudget?.day(clock.now()) ?? clock.now().slice(0, 10);
    const daily = await store.dailyTokens(day);
    const costUsd = plan ? (plan.inputTokens * plan.inputUsdPerMillion + plan.outputTokens * plan.outputUsdPerMillion) / 1e6 : 0;
    if (plan) assertCostBudget(await store.totalCostUsd(), costUsd, this.deps.modelBudget?.totalUsd ?? 0);
    const callId = clock.id();
    await store.mutate(id, detail => {
      if (detail.run.cancelRequested) throw new AppError('RUN_CANCELLED', 409);
      if (detail.run.status !== 'running') throw new AppError('RUN_NOT_RUNNING', 409);
      assertBudget(detail.run.limits, detail.run.usage, detail.run.userIds?.length ?? 0, daily, plan ? plan.inputTokens + plan.outputTokens : 0);
      detail.run.usage.modelCalls += 1;
      if (plan) {
        detail.run.usage.llmCalls += 1;
        (detail.run.calls ??= []).push({ ...plan, id: callId, day, state: 'reserved', costUsd });
      }
      this.event(detail, plan ? 'LLM_CALL_STARTED' : 'STUB_CALL');
    });
    return callId;
  }
  private async invoke<T>(id: string, task: 'classify' | 'draft', context: UserContext, playbook: Playbook, work: (options: ModelCallOptions) => Promise<T>, label?: string): Promise<T> {
    const { model, store } = this.deps;
    const plan = model.plan?.(task, context, playbook, label);
    if (model.mode === 'llm' && !plan) throw new AppError('MODEL_PLAN_REQUIRED');
    const callId = await this.reserveCall(id, plan);
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const timeout = setTimeout(() => controller.abort(new AppError('MODEL_TIMEOUT')), this.deps.modelBudget?.timeoutMs ?? 45000);
    // Observe cancellation requested by a different local process as well.
    const poll = setInterval(() => {
      void store.getRun(id).then(detail => {
        if (detail.run.cancelRequested) controller.abort(new AppError('RUN_CANCELLED'));
      }).catch(() => controller.abort(new AppError('STORAGE_READ_FAILED')));
    }, 250);
    try {
      const result = await work({ signal: controller.signal, reportUsage: async usage => {
        if (!plan || ![usage.inputTokens, usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new AppError('MODEL_USAGE_MISSING');
        await store.mutate(id, detail => {
          const call = detail.run.calls!.find(item => item.id === callId)!;
          if (call.state !== 'reserved') throw new AppError('MODEL_USAGE_DUPLICATE');
          call.inputTokens = usage.inputTokens;
          call.outputTokens = usage.outputTokens;
          call.costUsd = (usage.inputTokens * plan.inputUsdPerMillion + usage.outputTokens * plan.outputUsdPerMillion) / 1e6;
          call.state = 'reported';
          detail.run.usage.inputTokens += usage.inputTokens;
          detail.run.usage.outputTokens += usage.outputTokens;
          this.event(detail, 'LLM_USAGE_RECORDED', 'success');
        });
        if (usage.inputTokens > plan.inputTokens || usage.outputTokens > plan.outputTokens) throw new AppError('MODEL_USAGE_EXCEEDED');
      } });
      if (controller.signal.aborted) throw controller.signal.reason;
      if (plan && (await store.getRun(id)).run.calls!.find(call => call.id === callId)!.state !== 'reported') throw new AppError('MODEL_USAGE_MISSING');
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timeout); clearInterval(poll); this.inFlight.delete(id);
      if (plan) await store.mutate(id, detail => {
        const call = detail.run.calls!.find(item => item.id === callId)!;
        if (call.state === 'reserved') { call.state = 'unknown'; this.event(detail, 'LLM_USAGE_UNKNOWN', 'warning'); }
      });
    }
  }
  async generate(id: string): Promise<void> {
    const { store, users, model, files, clock } = this.deps;
    const { run } = await store.getRun(id);
    for (const userId of run.userIds ?? []) {
      const current = await this.checkpoint(id, 'context', userId);
      const existing = current.drafts.find(draft => draft.userId === userId);
      if (existing) { await files.saveDraft(existing); continue; }
      const context = anonymousContext(await users.getContext(userId), run.playbook.allowedFeatures);
      await store.mutate(id, detail => { (detail.run.contexts ??= {})[userId] = context; });
      await this.checkpoint(id, 'classify', userId);
      const labelId = await this.invoke(id, 'classify', context, run.playbook, options => model.classify(context, run.playbook, options));
      const label = run.playbook.labels.find(item => item.id === labelId);
      if (!label) throw new AppError('INVALID_LABEL');
      await store.mutate(id, detail => { (detail.run.classifications ??= {})[userId] = label.id; });
      await this.checkpoint(id, 'draft', userId);
      const output = await this.invoke(id, 'draft', context, run.playbook, options => model.draft(context, labelId, run.playbook, options), labelId);
      await this.checkpoint(id, 'guard', userId);
      if (checkDraft(output, run.playbook).length) throw new AppError('GUARD_REJECTED');
      const draft = {
        id: clock.id(), runId: id, userId, label: labelId, labelName: label.name, ...output,
        originalSubject: output.subject, originalBody: output.body, status: 'pending_approval' as const,
        version: 1, createdAt: clock.now(), updatedAt: clock.now(),
        playbookVersion: run.playbook.version,
      };
      await store.mutate(id, detail => {
        if (detail.run.cancelRequested) throw new AppError('RUN_CANCELLED', 409);
        detail.drafts.push(draft);
        detail.run.processed = detail.drafts.length;
        this.event(detail, 'DRAFT_SAVED', 'success');
      });
      await files.saveDraft(draft);
    }
  }
  async review(id: string, draftId: string, input: ReviewInput): Promise<RunDetail> {
    return this.deps.store.mutate(id, detail => {
      if (detail.run.status !== 'waiting_approval') throw new AppError('RUN_NOT_REVIEWABLE', 409);
      const draft = detail.drafts.find(item => item.id === draftId);
      if (!draft) throw new AppError('DRAFT_NOT_FOUND', 404);
      if (draft.status !== 'pending_approval' || draft.version !== input.version) throw new AppError('STALE_DRAFT', 409);
      // Validate even rejected edits: no raw contact data is retained in the audit trail.
      if (checkDraft(input, detail.run.playbook).length) throw new AppError('GUARD_REJECTED');
      detail.edits.push({ id: this.deps.clock.id(), draftId, at: this.deps.clock.now(), decision: input.decision, before: { subject: draft.subject, body: draft.body }, after: { subject: input.subject, body: input.body } });
      draft.subject = input.subject;
      draft.body = input.body;
      draft.status = input.decision;
      draft.version += 1;
      draft.updatedAt = this.deps.clock.now();
      detail.run.currentUserId = draft.userId;
      this.event(detail, input.decision === 'approved' ? 'DRAFT_APPROVED' : 'DRAFT_REJECTED', input.decision === 'approved' ? 'success' : 'warning');
      if (detail.drafts.every(item => item.status !== 'pending_approval')) {
        detail.run.status = 'queued';
        detail.run.ownerPid = this.deps.clock.pid;
        this.event(detail, 'REVIEW_COMPLETED', 'success');
      }
    }, { actor: 'operator', action: `draft.${input.decision}`, objectType: 'draft', objectId: draftId });
  }
  async send(id: string): Promise<void> {
    const detail = await this.checkpoint(id, 'send');
    for (const draft of detail.drafts) {
      if (draft.status !== 'approved') { await this.deps.files.saveDraft(draft); continue; }
      await this.checkpoint(id, 'send', draft.userId);
      const { receiptId } = await this.deps.sender.simulate(draft, detail.run.playbook);
      await this.deps.store.mutate(id, current => {
        const saved = current.drafts.find(item => item.id === draft.id)!;
        saved.status = 'simulated';
        saved.receiptId = receiptId;
        saved.updatedAt = this.deps.clock.now();
        saved.version += 1;
        this.event(current, 'SEND_SIMULATED', 'success');
      });
      await this.deps.files.saveDraft((await this.deps.store.getRun(id)).drafts.find(item => item.id === draft.id)!);
    }
    await this.checkpoint(id);
  }
  async settle(id: string, suspended: boolean): Promise<void> {
    await this.deps.store.mutate(id, detail => {
      if (detail.run.cancelRequested) {
        detail.run.status = 'cancelled';
        detail.run.finishedAt = this.deps.clock.now();
        this.event(detail, 'RUN_CANCELLED', 'warning');
      } else {
        detail.run.status = suspended ? 'waiting_approval' : 'completed';
        detail.run.step = suspended ? 'review' : 'done';
        if (!suspended) detail.run.finishedAt = this.deps.clock.now();
        this.event(detail, suspended ? 'WAITING_APPROVAL' : 'RUN_COMPLETED', 'success');
      }
      detail.run.currentUserId = undefined;
      detail.run.ownerPid = null;
    });
  }
  async fail(id: string, code: string): Promise<void> {
    await this.deps.store.mutate(id, detail => {
      if (!activeStatuses.includes(detail.run.status)) return;
      detail.run.status = detail.run.cancelRequested || code === 'RUN_CANCELLED' ? 'cancelled' : 'failed';
      detail.run.error = detail.run.status === 'failed' ? code : undefined;
      detail.run.finishedAt = this.deps.clock.now();
      detail.run.ownerPid = null;
      this.event(detail, detail.run.error ?? 'RUN_CANCELLED', detail.run.status === 'failed' ? 'error' : 'warning');
    });
  }
  async cancel(id: string, actor: 'operator' | 'system' = 'operator'): Promise<RunDetail> {
    const result = await this.deps.store.mutate(id, detail => {
      if (!activeStatuses.includes(detail.run.status)) throw new AppError('RUN_NOT_ACTIVE', 409);
      detail.run.cancelRequested = true;
      if (detail.run.status !== 'running') {
        detail.run.status = 'cancelled';
        detail.run.ownerPid = null;
        detail.run.finishedAt = this.deps.clock.now();
      }
      this.event(detail, 'CANCEL_REQUESTED', 'warning');
    }, { actor, action: 'run.cancel' });
    this.inFlight.get(id)?.abort(new AppError('RUN_CANCELLED'));
    return result;
  }
  async retry(id: string, limits: Limits): Promise<RunDetail> {
    const previous = await this.deps.store.getRun(id);
    const modelInfo = this.deps.model.info ?? { mode: 'stub', fast: 'stub', writer: 'stub' };
    const previousModel = previous.run.model ?? { mode: 'stub', fast: 'stub', writer: 'stub' };
    if (previousModel.mode !== modelInfo.mode || previousModel.fast !== modelInfo.fast || previousModel.writer !== modelInfo.writer) throw new AppError('MODEL_CHANGED', 409);
    const reserved = await this.deps.store.reservedUsers(previous.run.playbook.id, id);
    if (previous.run.userIds?.some(userId => reserved.has(userId))) throw new AppError('RETRY_USER_CONFLICT', 409);
    return this.deps.store.mutate(id, detail => {
      if (!retryableStatuses.includes(detail.run.status)) throw new AppError('RUN_NOT_RETRYABLE', 409);
      if ((detail.run.userIds?.length ?? 0) > limits.maxUsers) throw new AppError('USER_LIMIT');
      detail.run.status = 'queued';
      detail.run.ownerPid = this.deps.clock.pid;
      detail.run.cancelRequested = false;
      detail.run.error = undefined;
      detail.run.finishedAt = undefined;
      detail.run.attempt += 1;
      detail.run.workflowRunId = `${id}-${detail.run.attempt}`;
      detail.run.limits = limits;
      this.event(detail, 'RETRY_REQUESTED');
    }, { actor: 'operator', action: 'run.retry' });
  }
}
