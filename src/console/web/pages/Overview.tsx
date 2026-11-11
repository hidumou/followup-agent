import { ArrowRight, CalendarClock, AlertTriangle } from 'lucide-react';
import type { WorkspaceData } from '../types.ts';
import { Budget, Panel, RunTable } from '../components/Common.tsx';
import { money, time, messages } from '../copy.ts';
import s from '../console.module.css';
export function Overview({
  data,
  onRun,
  onApprove,
  onSchedule,
  onFollowups
}: {
  data: WorkspaceData;
  onRun: (id: string) => void;
  onApprove: () => void;
  onSchedule: () => void;
  onFollowups: () => void;
}) {
  const {
    overview: o,
    config,
    schedule
  } = data;
  return <><div className={s.stats}>{[['今日发现', o.discovered, '位用户'], ['今日草稿', o.drafted, '份草稿'], ['待审批', o.reviewable, '份可处理'], ['今日模拟发送', o.simulated, '份已完成'], ['今日回复', '—', 'M3 接入']].map(([label, value, hint]) => <div key={label} className={s.stat}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div><div className={s.notice}><CalendarClock /><div><strong>工作日 09:00 自动回访</strong><span>Asia/Taipei · {schedule.schedule.enabled && schedule.runner.loaded ? `下次 ${schedule.schedule.nextRunAt ? time(schedule.schedule.nextRunAt) : '待计算'}` : '计划暂停或调度器未加载'} · 漏跑跳过</span></div><button className={s.link} onClick={onSchedule}>查看计划<ArrowRight /></button></div><div className={s.dashboardColumns}><Panel title="待办事项"><button className={s.todo} onClick={onApprove}><div><strong>{o.reviewable ? `${o.reviewable} 份草稿等待审批` : '暂无待审批草稿'}</strong><small>人工确认后执行模拟发送</small></div><ArrowRight /></button><button className={s.todo} onClick={onFollowups}><div><strong>查看用户回访记录</strong><small>按状态、场景、版本和时间筛选</small></div><ArrowRight /></button></Panel><Panel title="今日用量" aside={<span className={s.muted}>{o.today} · 台北</span>}><Budget tokens={o.tokens} limit={config.limits.dailyTokens} /><dl className={s.facts}><div><dt>今日估算费用</dt><dd className={s.mono}>{money(o.costUsd)}</dd></div><div><dt>累计 / 费用上限</dt><dd className={s.mono}>{money(o.totalCostUsd)} / ${config.budgetUsd.toFixed(2)}</dd></div></dl><p className={s.note}>{config.model.mode === 'llm' ? config.model.writer : '离线模拟模型'} · 未确认用量按预留计算</p></Panel></div>{o.exceptions.length > 0 && <Panel title="需要关注"><ul className={s.plainList}>{o.exceptions.map(run => <li key={run.id}><AlertTriangle className={s.danger} /><div><strong>{run.playbook.name}</strong><small>{messages[run.error ?? ''] ?? '运行中断，等待人工处理'}</small></div><button className={s.link} onClick={() => onRun(run.id)}>查看运行</button></li>)}</ul></Panel>}<Panel title="最近运行" aside={<span className={s.muted}>最近 5 次</span>}><RunTable runs={o.recent} onOpen={onRun} /></Panel></>;
}
