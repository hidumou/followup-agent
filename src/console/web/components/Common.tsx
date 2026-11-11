import { AlertTriangle, ArrowLeft, Check, CheckCheck, Clock3, FileText, Square, X } from 'lucide-react';
import type { ReactNode, CSSProperties } from 'react';
import type { RunRecord } from '../../../core/domain/index.ts';
import { statuses, versionLabel, time, money } from '../copy.ts';
import s from '../console.module.css';
export function Badge({
  status
}: {
  status: string;
}) {
  const Icon = ['failed', 'interrupted'].includes(status) ? AlertTriangle : ['completed', 'simulated'].includes(status) ? CheckCheck : status === 'rejected' || status === 'cancelled' ? X : status === 'approved' ? Check : Clock3;
  const tone = ['failed', 'interrupted'].includes(status) ? s.danger : ['completed', 'simulated'].includes(status) ? s.success : ['pending_approval', 'waiting_approval', 'running'].includes(status) ? s.accent : s.neutral;
  return <span className={`${s.badge} ${tone}`}><Icon aria-hidden="true" />{statuses[status] ?? status}</span>;
}
export function Version({
  value,
  onClick
}: {
  value?: number | null;
  onClick?: () => void;
}) {
  return onClick && value ? <button className={s.version} onClick={onClick}>{versionLabel(value)}</button> : <span className={s.version}>{versionLabel(value)}</span>;
}
export function Empty({
  title,
  children
}: {
  title: string;
  children?: ReactNode;
}) {
  return <div className={s.empty}><FileText aria-hidden="true" /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Skeleton() {
  return <div className={s.skeleton} aria-label="正在加载" aria-busy="true"><span /><span /><span /></div>;
}
export function Panel({
  title,
  aside,
  children
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return <section className={s.panel}><div className={s.panelHead}><h2>{title}</h2>{aside}</div>{children}</section>;
}
export function Budget({
  tokens,
  limit,
  compact = false
}: {
  tokens: number;
  limit: number;
  compact?: boolean;
}) {
  const ratio = limit ? tokens / limit : 0;
  return <div className={`${s.budget} ${ratio >= 1 ? s.danger : ratio >= .8 ? s.warning : ''}`}><span>今日 Token {Math.round(ratio * 100)}%</span><div className={s.bar} role="progressbar" aria-label="今日 Token 预算" aria-valuenow={Math.min(100, Math.round(ratio * 100))} aria-valuemin={0} aria-valuemax={100}><i style={{
        '--progress': `${Math.min(1, ratio) * 100}%`
      } as CSSProperties} /></div>{!compact && <small>{tokens.toLocaleString()} / {limit.toLocaleString()}</small>}</div>;
}
export function RunTable({
  runs,
  onOpen
}: {
  runs: RunRecord[];
  onOpen: (id: string) => void;
}) {
  return runs.length ? <div className={s.tableWrap}><table><thead><tr><th>开始时间</th><th>任务 / 来源</th><th>状态</th><th>模型调用</th><th>估算费用</th><th><span className={s.srOnly}>操作</span></th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td>{time(run.createdAt)}</td><td><strong>{run.playbook.name}</strong><small>{run.trigger?.kind === 'scheduled' ? '定时发起' : '手动发起'} · 第 {run.attempt} 次尝试</small></td><td><Badge status={run.status} /></td><td>{run.usage.modelCalls} <small>真实 AI {run.usage.llmCalls} 次</small></td><td className={s.mono}>{money((run.calls ?? []).reduce((sum, item) => sum + item.costUsd, 0))}</td><td><button className={s.link} onClick={() => onOpen(run.id)}>查看运行</button></td></tr>)}</tbody></table></div> : <Empty title="还没有运行记录">发起回访后，这里会记录执行状态和模型用量。</Empty>;
}
export function RunActions({
  run,
  busy,
  onAction
}: {
  run: RunRecord;
  busy: boolean;
  onAction: (action: 'retry' | 'cancel', id: string) => void;
}) {
  return <div className={s.actions}>{['failed', 'cancelled', 'interrupted'].includes(run.status) && <button className={s.button} disabled={busy} onClick={() => onAction('retry', run.id)}>人工重试</button>}{['queued', 'running', 'waiting_approval'].includes(run.status) && <button className={s.button} disabled={busy || run.cancelRequested} onClick={() => onAction('cancel', run.id)}><Square />{run.cancelRequested ? '停止中' : '停止运行'}</button>}</div>;
}
export function Back({
  onClick,
  children
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return <button className={s.link} onClick={onClick}><ArrowLeft />{children}</button>;
}
export function GuardList({
  errors,
  checking = false
}: {
  errors: string[];
  checking?: boolean;
}) {
  const guards = [['长度与主题', ['INVALID_LENGTH', 'INVALID_SUBJECT']], ['无联系方式', ['PII_DETECTED']], ['退订说明', ['MISSING_UNSUBSCRIBE']], ['无禁止承诺', ['FORBIDDEN_PROMISE']]] as const;
  return <div className={s.guards} aria-live="polite">{guards.map(([name, codes]) => {
      const bad = codes.some(code => errors.includes(code));
      return <span key={name} className={checking ? s.muted : bad ? s.danger : s.success}>{checking ? <Clock3 /> : bad ? <AlertTriangle /> : <Check />}{name} · {checking ? '检查中' : bad ? '未通过' : '通过'}</span>;
    })}</div>;
}
