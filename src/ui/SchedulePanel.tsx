import type { ScheduleSnapshot } from '../core/schedule/index.ts';
import type { RunnerStatus } from '../adapters/launchd/scheduler.ts';
import type { RunRecord } from '../core/domain/index.ts';
import { statuses, time } from './copy.ts';

export interface ScheduleData extends ScheduleSnapshot { runner: RunnerStatus }
export function scheduleHealth(data: ScheduleData, runs: RunRecord[] = []): string {
  if (!data.schedule.enabled) return '已暂停';
  if (data.runner.supported && !data.runner.loaded) return '后台未连接';
  if (data.runner.lastExitCode) return '最近检查异常';
  if (runs.some(run => run.trigger?.kind === 'scheduled' && ['queued', 'running'].includes(run.status))) return 'Agent 正在执行';
  if (!data.schedule.lastTickAt) return '等待首次检查';
  if (Date.now() - Date.parse(data.schedule.lastTickAt) > 90_000) return '检查延迟';
  return '自动回访已开启';
}
export function SchedulePanel({ data, runs, playbook, maxUsers, busy, onToggle, onRun }: {
  data: ScheduleData; runs: RunRecord[]; playbook: string; maxUsers: number; busy: boolean;
  onToggle(): void; onRun(id: string): void;
}) {
  const { schedule, occurrences, runner } = data;
  const active = runs.find(run => ['queued', 'running', 'waiting_approval'].includes(run.status));
  return <div className="schedule-layout">
    <section className="panel schedule-plan">
      <div className="panel-heading"><div><span className="section-kicker">AUTOMATIC FOLLOWUP</span><h2>工作日回访计划</h2></div><span className="label-chip">{scheduleHealth(data, runs)}</span></div>
      <div className="schedule-time"><strong>09:00</strong><div>每周一至周五<small>Asia/Taipei · 不区分节假日</small></div><button className={`button ${schedule.enabled ? '' : 'primary'}`} disabled={busy} onClick={onToggle}>{schedule.enabled ? '暂停计划' : '开启计划'}</button></div>
      <dl className="schedule-facts"><div><dt>下一次计划</dt><dd>{schedule.nextRunAt ? time(schedule.nextRunAt) : '暂停期间不触发'}</dd></div><div><dt>业务手册</dt><dd>{playbook} · 最多 {maxUsers} 位</dd></div><div><dt>后台最近检查</dt><dd>{schedule.lastTickAt ? time(schedule.lastTickAt) : '尚无检查记录'}</dd></div><div><dt>漏跑策略</dt><dd>全部跳过，等待下一次计划</dd></div></dl>
      {!runner.loaded && runner.supported && <p className="schedule-warning">后台任务尚未连接。在项目目录执行 <code>pnpm schedule:install</code> 后，关闭网页也能按时触发。</p>}
      {active && <p className="schedule-warning">当前有一项{statuses[active.status]}的任务。若到计划时间仍未结束，本次计划将跳过。<button className="text-button" onClick={() => onRun(active.id)}>查看任务 →</button></p>}
      <p className="muted small">暂停只影响未来的计划，不会停止已开始的运行。电脑需开机、登录且保持唤醒；关闭网页或 UI 服务不影响后台任务。</p>
    </section>
    <section className="panel schedule-flow"><span className="section-kicker">FROM SCHEDULE TO REVIEW</span><h2>到点之后，Agent 自动接手</h2><ol>{[
      ['检查计划', '在 09:00 这一分钟内检查；漏过的计划只记录跳过。'],
      ['筛选与生成', '去重虚构用户，匿名化上下文，调用 AI 分类并撰写草稿。'],
      ['等待你的审批', '通过护栏后暂停。你可以编辑、批准或拒绝。'],
      ['完成模拟发送', '全部审批结束后继续；失败、中断或取消需人工重试。'],
    ].map(([title, description], i) => <li key={title}><b>{i + 1}</b><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol></section>
    <section className="panel schedule-history"><div className="panel-heading"><h2>计划触发记录 <span className="count">{occurrences.length}</span></h2><span className="muted small">最近 100 次 · 台北时间</span></div>{occurrences.length ? <div className="table-scroll"><table><thead><tr><th>计划时间</th><th>触发结果</th><th>说明 / 运行状态</th><th/></tr></thead><tbody>{occurrences.map(item => {
      const run = runs.find(run => run.id === item.runId);
      const label = item.outcome === 'started' ? '已发起' : item.outcome === 'skipped' ? '已跳过' : '发起失败';
      const reason = item.reason === 'MISSED_WINDOW' ? '错过计划时间，不补跑' : item.reason === 'RUN_ALREADY_ACTIVE' ? '已有运行或待审批任务' : item.reason === 'TRIGGER_FAILED' ? '创建失败，需检查配置' : run ? statuses[run.status] : '查看运行详情';
      return <tr key={item.plannedAt}><td>{time(item.plannedAt)}<small>检查于 {time(item.observedAt)}</small></td><td><span className={`badge ${item.outcome === 'started' ? 'approved' : item.outcome === 'failed' ? 'failed' : 'cancelled'}`}><i/>{label}</span></td><td>{reason}</td><td>{item.runId && <button className="text-button" onClick={() => onRun(item.runId!)}>查看运行 →</button>}</td></tr>;
    })}</tbody></table></div> : <div className="compact-empty">下一次计划到点后，发起或跳过的结果都会记录在这里。</div>}</section>
  </div>;
}
