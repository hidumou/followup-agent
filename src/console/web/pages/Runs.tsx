import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Circle, LoaderCircle } from 'lucide-react';
import type { RunRecord } from '../../../core/domain/index.ts';
import type { RunView, ScheduleData } from '../types.ts';
import { api } from '../api.ts';
import { messages, steps, time, errorText, money } from '../copy.ts';
import { Back, Badge, Empty, Panel, RunActions, RunTable, Skeleton, Version } from '../components/Common.tsx';
import s from '../console.module.css';
export function Runs({
  runs,
  selected,
  onSelect,
  tab,
  onTab,
  schedule,
  busy,
  onAction,
  onSchedule
}: {
  runs: RunRecord[];
  selected?: string;
  onSelect: (id?: string) => void;
  tab: 'history' | 'schedule';
  onTab: (tab: 'history' | 'schedule') => void;
  schedule: ScheduleData;
  busy: boolean;
  onAction: (action: 'retry' | 'cancel', id: string) => void;
  onSchedule: () => void;
}) {
  const [detail, setDetail] = useState<RunView>(),
    [error, setError] = useState('');
  useEffect(() => {
    setDetail(undefined);
    setError('');
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        setDetail(await api<RunView>(`/runs/${selected}`, undefined, controller.signal));
        setError('');
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected]);
  if (selected) return <><Back onClick={() => onSelect(undefined)}>运行记录</Back>{error && <p className={s.error} role="alert">{error}</p>}{detail ? <RunDetailView detail={detail} busy={busy} onAction={onAction} /> : <Skeleton />}</>;
  return <><div className={s.tabs} role="tablist" aria-label="运行视图"><button role="tab" aria-selected={tab === 'history'} onClick={() => onTab('history')}>运行记录</button><button role="tab" aria-selected={tab === 'schedule'} onClick={() => onTab('schedule')}>自动回访</button></div>{tab === 'history' ? <Panel title="全部运行" aside={<span className={s.muted}>{runs.length} 次</span>}><RunTable runs={runs} onOpen={onSelect} /></Panel> : <ScheduleView value={schedule} busy={busy} onToggle={onSchedule} onOpen={onSelect} />}</>;
}
function RunDetailView({
  detail,
  busy,
  onAction
}: {
  detail: RunView;
  busy: boolean;
  onAction: (action: 'retry' | 'cancel', id: string) => void;
}) {
  const {
      run
    } = detail,
    flow = ['discover', 'context', 'classify', 'draft', 'guard', 'review', 'send', 'done'];
  return <><div className={s.detailHead}><div><h1>{run.playbook.name}</h1><p className={s.muted}>{time(run.createdAt)} · {run.trigger?.kind === 'scheduled' ? '定时发起' : '手动发起'} · <Version value={run.playbook.version} /></p></div><div className={s.actions}><Badge status={run.status} /><RunActions run={run} busy={busy} onAction={onAction} /></div></div>{run.error && <p className={s.error}><AlertTriangle />{messages[run.error] ?? run.error} · 不会自动重试</p>}<section className={s.panel}><div className={s.stepper}>{flow.map((step, index) => {
          const done = run.status === 'completed' || flow.indexOf(run.step) > index;
          const current = step === run.step;
          const Icon = done ? Check : current && run.status === 'running' ? LoaderCircle : Circle;
          return <div key={step} className={current ? s.current : done ? s.success : s.muted}><Icon className={current && run.status === 'running' ? s.spin : undefined} /><span>{steps[step]}</span></div>;
        })}</div><div className={s.runSummary}><span>用户进度 <strong>{run.processed} / {run.userIds?.length ?? '—'}</strong></span><span>跳过 <strong>{run.skipped}</strong></span><span>模型调用 <strong>{run.usage.modelCalls} / {run.limits.maxCalls}</strong></span><span>Token <strong>{run.usage.inputTokens + run.usage.outputTokens}</strong></span><span>估算费用 <strong>{money((run.calls ?? []).reduce((sum, call) => sum + call.costUsd, 0))}</strong></span></div><p className={s.note}>模型：{run.model?.writer ?? 'stub'} · 第 {run.attempt} 次尝试 · {(run.calls ?? []).filter(call => call.state !== 'reported').length} 次用量待确认（保留预算预留）</p></section><div className={s.twoColumns}><Panel title="运行事件"><ol className={s.timeline}>{detail.events.slice().reverse().map(event => <li key={event.id}><span className={event.kind === 'error' ? s.danger : s.muted}>{time(event.at)}</span><div><strong>{messages[event.code] ?? event.code}</strong><small>{steps[event.step]}{event.userId && ` · ${event.userId}`}</small></div></li>)}</ol></Panel><div className={s.stack}><Panel title="草稿结果">{detail.drafts.length ? <ul className={s.plainList}>{detail.drafts.map(draft => <li key={draft.id}><span className={s.mono}>{draft.userId}</span><Badge status={draft.status} /></li>)}</ul> : <Empty title="尚无草稿" />}</Panel><Panel title="操作审计">{detail.audit.length ? <ol className={s.timeline}>{detail.audit.filter(entry => entry.actor === 'operator').map(entry => <li key={entry.id}><span className={s.muted}>{time(entry.at)}</span><div><strong>{({
                    'run.start': '发起回访',
                    'run.cancel': '停止运行',
                    'run.retry': '人工重试',
                    'draft.approved': '批准草稿',
                    'draft.rejected': '拒绝草稿'
                  } as Record<string, string>)[entry.action] ?? entry.action}</strong><small>操作人 · 本地操作者</small></div></li>)}</ol> : <p className={s.muted}>此历史运行未记录操作审计。</p>}<p className={s.note}>运行 ID <span className={s.mono}>{run.id}</span></p></Panel></div></div></>;
}
function ScheduleView({
  value,
  busy,
  onToggle,
  onOpen
}: {
  value: ScheduleData;
  busy: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const {
    schedule,
    runner,
    occurrences
  } = value;
  return <><Panel title="工作日自动回访" aside={<button className={s.button} disabled={busy} onClick={onToggle}>{schedule.enabled ? '暂停计划' : '启用计划'}</button>}><div className={s.scheduleLead}><CalendarClock /><div><h2>每个工作日 09:00</h2><p>Asia/Taipei · 周一至周五</p></div><span className={`${s.badge} ${schedule.enabled ? s.success : s.neutral}`}>{schedule.enabled ? '已启用' : '已暂停'}</span></div><dl className={s.facts}><div><dt>下次运行</dt><dd>{schedule.nextRunAt ? time(schedule.nextRunAt) : '—'}</dd></div><div><dt>本机调度器</dt><dd>{runner.loaded ? '已加载，关闭网页后仍可触发' : runner.installed ? '已安装，尚未加载' : '未安装'}</dd></div><div><dt>最近检查</dt><dd>{schedule.lastTickAt ? time(schedule.lastTickAt) : '尚未检查'}</dd></div><div><dt>漏跑与失败</dt><dd>漏跑跳过，等待下次计划；失败后人工重试</dd></div></dl>{!runner.loaded && <p className={s.notice}>需在本机项目目录运行 <code>pnpm schedule:install</code>，调度器才能在网页关闭后工作。</p>}<p className={s.note}>计划使用当前默认 Playbook，遵守每次用户数、模型调用和费用上限。草稿始终等待人工审批。</p></Panel><Panel title="计划触发记录">{occurrences.length ? <div className={s.tableWrap}><table><thead><tr><th>计划时间</th><th>检查时间</th><th>结果</th><th>原因 / 运行</th></tr></thead><tbody>{occurrences.map(item => <tr key={item.plannedAt}><td>{time(item.plannedAt)}</td><td>{time(item.observedAt)}</td><td>{{
                  started: '已发起',
                  skipped: '已跳过',
                  failed: '发起失败'
                }[item.outcome]}</td><td>{item.runId ? <button className={s.link} onClick={() => onOpen(item.runId!)}>查看运行</button> : {
                  MISSED_WINDOW: '已错过计划时间',
                  RUN_ALREADY_ACTIVE: '已有进行中的运行',
                  TRIGGER_FAILED: '触发失败'
                }[item.reason ?? 'TRIGGER_FAILED']}</td></tr>)}</tbody></table></div> : <Empty title="暂无触发记录">到达计划时间后，触发结果会保存在这里。</Empty>}</Panel></>;
}
