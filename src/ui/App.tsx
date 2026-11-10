import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Draft, Limits, Playbook, RunDetail, RunRecord } from '../core/domain/index.ts';
import { messages, statuses, steps, time } from './copy.ts';

type View = 'overview' | 'drafts' | 'history' | 'playbooks';
interface Config { playbooks: Playbook[]; defaultPlaybook: string; limits: Limits }
const navigation: [View, string, string][] = [['overview', '工作台', 'grid'], ['drafts', '草稿审批', 'mail'], ['history', '运行记录', 'clock'], ['playbooks', '业务手册', 'book']];
const flow = ['discover', 'context', 'classify', 'draft', 'guard', 'review', 'send'];

async function api<T>(path: string, input?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
  catch { throw new Error('NETWORK_ERROR'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'INTERNAL_ERROR');
  return data as T;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    book: <><path d="M12 5c-4-3-8-1-9 0v15c3-2 6-2 9 0 3-2 6-2 9 0V5c-3-2-6-2-9 0Z"/><path d="M12 5v15"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>, check: <path d="m5 12 4 4L19 6"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>, stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.spark}</svg>;
}
function Badge({ status }: { status: string }) { return <span className={`badge ${status}`}><i/>{statuses[status] ?? status}</span>; }
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon name="spark" size={28}/></span><h3>{title}</h3><p>{children}</p></div>; }

export function App() {
  const [view, setView] = useState<View>('overview');
  const [config, setConfig] = useState<Config>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<RunDetail>();
  const [selectedDraftId, setSelectedDraftId] = useState<string>();
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [draftFilter, setDraftFilter] = useState('all');
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { void api<Config>('/config').then(setConfig).catch(() => setConnectionError(true)); }, []);
  useEffect(() => {
    let stale = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const { runs: latest } = await api<{ runs: RunRecord[] }>('/runs');
        if (stale) return;
        setRuns(latest);
        const id = selectedId ?? latest.find(run => ['queued', 'running', 'waiting_approval'].includes(run.status))?.id ?? latest[0]?.id;
        if (id) {
          const value = await api<RunDetail>(`/runs/${id}`);
          if (stale) return;
          setDetail(value);
          if (!selectedId) setSelectedId(id);
        }
        setConnectionError(false);
      } catch { if (!stale) setConnectionError(true); }
      finally { if (!stale) setLoading(false); }
    };
    refreshRef.current = refresh;
    const tick = async () => { await refresh(); if (!stale) timer = setTimeout(() => void tick(), 1000); };
    void tick();
    return () => { stale = true; clearTimeout(timer); };
  }, [selectedId]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); await refreshRef.current(); }
    catch (reason) { const code = reason instanceof Error ? reason.message : 'INTERNAL_ERROR'; setError(messages[code] ?? `操作未完成：${code}`); }
    finally { setBusy(false); }
  }
  const run = detail?.run;
  const active = runs.find(item => ['queued', 'running', 'waiting_approval'].includes(item.status));
  const drafts = detail?.drafts ?? [];
  const pending = drafts.filter(draft => draft.status === 'pending_approval').length;
  const simulated = drafts.filter(draft => draft.status === 'simulated').length;
  const visibleDrafts = drafts.filter(draft => draftFilter === 'all' || draft.status === draftFilter);
  const currentDraft = visibleDrafts.find(draft => draft.id === selectedDraftId) ?? visibleDrafts.find(draft => draft.status === 'pending_approval') ?? visibleDrafts[0];
  const chooseRun = (id: string) => { if (selectedId !== id) { setDetail(undefined); setLoading(true); } setSelectedId(id); setSelectedDraftId(undefined); setView('overview'); };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" aria-label="回响工作台" href="#" onClick={event => { event.preventDefault(); setView('overview'); }}><span className="brand-symbol">↗</span><div>回响<span>FOLLOWUP AGENT</span></div></a>
      <div className="workspace"><span className="workspace-avatar">回</span><div>我的工作空间<small>本地 · 单人工作台</small></div><span className="workspace-dots">···</span></div>
      <p className="nav-label">工作空间</p>
      <nav aria-label="主导航">{navigation.map(([key, label, icon]) => <button key={key} aria-label={label} title={label} className={view === key ? 'nav-item selected' : 'nav-item'} onClick={() => setView(key)}><Icon name={icon}/><span>{label}</span>{key === 'drafts' && pending > 0 && <b>{pending}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><span className={`connection-dot ${connectionError ? 'offline' : ''}`}/><strong>{connectionError ? '服务连接中断' : '本地运行环境'}</strong><p>Mock 数据 · Stub 模型<br/>所有邮件仅模拟发送</p></div><div className="profile"><span>H</span><div>本地管理员<small>M0 · 产品验证</small></div><Icon name="shield" size={18}/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="muted">工作空间</span><span className="breadcrumb">/</span>{navigation.find(item => item[0] === view)?.[1]}</div><div className="topbar-right"><span className="environment"><i/>DRY RUN</span><span className="avatar">H</span></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">LISTEN. LEARN. RECONNECT.</p><h1>{view === 'overview' ? '让每一次回访，有迹可循。' : navigation.find(item => item[0] === view)?.[1]}</h1><p>{view === 'overview' ? '从发现用户到草稿审批，掌握 Agent 的每一步。' : view === 'drafts' ? '审阅措辞，保留你的判断。全部处理后统一模拟发送。' : view === 'history' ? '回看执行过程、人工决策和每次运行的结果。' : '用独立的业务配置，定义回访目标、分类和话术。'}</p></div><button className="button primary" disabled={!config || busy || !!active} onClick={() => setShowStart(true)}><Icon name="play" size={16}/>发起回访</button></div>
        {(error || connectionError) && <div className="alert" role="alert">{error || messages.NETWORK_ERROR}<button aria-label="重新加载" onClick={() => { setError(''); void refreshRef.current(); if (!config) void api<Config>('/config').then(setConfig).catch(() => {}); }}><Icon name="refresh" size={16}/></button></div>}
        {active && run?.id !== active.id && <button className="active-notice" onClick={() => chooseRun(active.id)}>有一项{statuses[active.status]}的回访任务，点击查看 <Icon name="arrow" size={16}/></button>}
        {view === 'overview' && <>
          <div className="stats-grid">{[
            ['本次回访用户', String(run?.userIds?.length ?? 0), 'users', run ? `${run.skipped} 位已去重或未选入本批次` : '等待发起首次回访'],
            ['待人工审批', String(pending), 'mail', pending ? '你的判断，让回访更有温度' : '当前没有待审批草稿'],
            ['已模拟发送', String(simulated), 'check', '真实邮件发送量为 0'],
            ['模拟模型调用', String(run?.usage.modelCalls ?? 0), 'spark', `真实 LLM 0 次 · Token ${run ? run.usage.inputTokens + run.usage.outputTokens : 0}`],
          ].map(([label, value, icon, note]) => <section className="stat" key={label}><div><span>{label}</span><span className="stat-icon"><Icon name={icon} size={18}/></span></div><strong>{value}{label === '模拟模型调用' && <small> / {run?.limits.maxCalls ?? config?.limits.maxCalls ?? '—'}</small>}</strong><p>{note}</p></section>)}</div>
          <div className="workspace-grid"><section className="panel execution-panel"><div className="panel-heading"><div><span className="section-kicker">AGENT RUNTIME</span><h2>运行现场 {run && <Badge status={run.status}/>}</h2></div>{run && <span className="mono small">#{run.id.slice(0, 8)}</span>}</div>
            {loading ? <Empty title="正在读取工作台">连接本地运行记录…</Empty> : !run ? <Empty title="准备好，开始第一次倾听">选择一个业务手册，Agent 会自动筛选虚构用户并生成待审批草稿。<br/><button className="text-button" onClick={() => setShowStart(true)} disabled={!config}>创建首次回访 <Icon name="arrow" size={16}/></button></Empty> : <>
              <div className="run-summary"><div><strong>{run.playbook.name}</strong><span>{time(run.createdAt)} · 第 {run.attempt} 次尝试</span></div><div className="run-actions">{['failed', 'cancelled', 'interrupted'].includes(run.status) && <button className="button small-button" disabled={busy} onClick={() => void action(async () => { await api(`/runs/${run.id}/retry`, {}); })}><Icon name="refresh" size={15}/>人工重试</button>}{['queued', 'running', 'waiting_approval'].includes(run.status) && <button className="button small-button" disabled={busy || run.cancelRequested} onClick={() => void action(async () => { await api(`/runs/${run.id}/cancel`, {}); })}><Icon name="stop" size={14}/>{run.cancelRequested ? '停止中' : '停止运行'}</button>}</div></div>
              <div className="flow-track">{flow.map((step, index) => {
                const current = run.step === step;
                const done = run.status === 'completed' || flow.indexOf(run.step) > index;
                return <div key={step} className={`flow-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}><span>{done ? <Icon name="check" size={14}/> : index + 1}</span><small>{steps[step]}</small></div>;
              })}</div>
              <div className={`runtime-callout ${run.status}`}><span className="runtime-symbol"><Icon name={run.status === 'waiting_approval' ? 'mail' : run.status === 'completed' ? 'check' : 'spark'}/></span><div><strong>{run.status === 'waiting_approval' ? '草稿已就绪，接下来交给你。' : run.status === 'completed' ? '本次回访已完成。' : run.status === 'running' ? `正在${steps[run.step]}` : statuses[run.status]}</strong><p>{run.error ? messages[run.error] ?? run.error : run.status === 'waiting_approval' ? `${pending} 封待审批。你可以编辑、批准或拒绝，全部处理后继续执行。` : run.status === 'completed' ? `${simulated} 封模拟发送 · ${drafts.filter(d => d.status === 'rejected').length} 封拒绝 · 没有发送真实邮件` : run.status === 'cancelled' ? '已保留草稿和记录。可以人工重试。' : run.currentUserId ? `当前用户 ${run.currentUserId}` : '运行状态与事件会自动更新。'}</p></div>{run.status === 'waiting_approval' && <button className="text-button" onClick={() => setView('drafts')}>去审批 <Icon name="arrow" size={16}/></button>}</div>
              <div className="progress-label"><span>草稿生成进度</span><b>{run.processed} / {run.userIds?.length ?? '—'}</b></div><div className="progress-track"><span style={{ width: `${run.userIds?.length ? run.processed / run.userIds.length * 100 : 0}%` }}/></div>
            </>}
          </section><section className="panel guard-panel"><span className="guard-icon"><Icon name="shield" size={23}/></span><h2>始终保留人工判断</h2><p>Agent 完成重复工作，<br/>你掌握每一次回访的决定。</p><ul><li><Icon name="check" size={15}/>匿名行为上下文</li><li><Icon name="check" size={15}/>确定性内容护栏</li><li><Icon name="check" size={15}/>审批后才模拟发送</li><li><Icon name="check" size={15}/>每次运行都有上限</li></ul><span className="guard-foot">MOCK WORKSPACE / M0</span></section></div>
          <div className="lower-grid"><section className="panel"><div className="panel-heading"><h2>草稿预览 <span className="count">{drafts.length}</span></h2><button className="text-button" onClick={() => setView('drafts')}>查看全部 <Icon name="arrow" size={14}/></button></div>{drafts.length ? <div className="draft-preview-list">{drafts.slice(0, 3).map(draft => <button key={draft.id} className="draft-preview" onClick={() => { setSelectedDraftId(draft.id); setView('drafts'); }}><span className="user-glyph"><Icon name="mail" size={18}/></span><div><strong>{draft.subject}</strong><small>{draft.userId} <span>· {draft.labelName}</span></small></div><Badge status={draft.status}/></button>)}</div> : <div className="compact-empty">生成的回访草稿会出现在这里。</div>}</section><EventPanel detail={detail}/></div>
        </>}
        {view === 'drafts' && <>
          <div className="toolbar"><div className="filter-tabs">{[['all', '全部草稿'], ['pending_approval', '待审批'], ['simulated', '已模拟发送']].map(([key, label]) => <button key={key} className={draftFilter === key ? 'chosen' : ''} onClick={() => setDraftFilter(key)}>{label}</button>)}</div><select aria-label="选择回访任务" value={selectedId ?? ''} onChange={event => { setDetail(undefined); setLoading(true); setSelectedId(event.target.value); setSelectedDraftId(undefined); }}><option value="" disabled>选择回访任务</option>{runs.map(item => <option key={item.id} value={item.id}>{time(item.createdAt)} · {item.playbook.name} · {statuses[item.status]}</option>)}</select></div>
          {drafts.length ? <div className="review-layout"><section className="panel draft-list">{drafts.filter(item => draftFilter === 'all' || item.status === draftFilter).map(draft => <button key={draft.id} className={`draft-choice ${currentDraft?.id === draft.id ? 'chosen' : ''}`} onClick={() => setSelectedDraftId(draft.id)}><div><span className="small mono">{draft.userId}</span><Badge status={draft.status}/></div><strong>{draft.subject}</strong><p>{draft.body.slice(0, 55)}…</p><span className="label-chip">{draft.labelName}</span></button>)}{!drafts.some(item => draftFilter === 'all' || item.status === draftFilter) && <div className="compact-empty">该分类下暂无草稿。</div>}</section>{currentDraft && <DraftEditor draft={currentDraft} detail={detail!} busy={busy} onReview={(decision, subject, body) => void action(async () => { await api(`/runs/${currentDraft.runId}/drafts/${currentDraft.id}/review`, { version: currentDraft.version, decision, subject, body }); })}/>}</div> : <section className="panel"><Empty title="还没有回访草稿">发起一次回访后，你可以在这里审阅和编辑草稿。</Empty></section>}
        </>}
        {view === 'history' && <section className="panel history-panel"><div className="panel-heading"><h2>全部运行 <span className="count">{runs.length}</span></h2><span className="muted small">最近 100 次 · 自动更新</span></div>{runs.length ? <div className="table-scroll"><table><thead><tr><th>任务 / 业务手册</th><th>状态</th><th>草稿进度</th><th>模拟调用</th><th>开始时间</th><th/></tr></thead><tbody>{runs.map(item => <tr key={item.id}><td><strong>{item.playbook.name}</strong><small className="mono">#{item.id.slice(0, 8)} · 第 {item.attempt} 次尝试</small></td><td><Badge status={item.status}/></td><td>{item.processed} / {item.userIds?.length ?? '—'}</td><td>{item.usage.modelCalls}</td><td>{time(item.createdAt)}</td><td><button className="text-button" onClick={() => chooseRun(item.id)}>详情 <Icon name="arrow" size={14}/></button></td></tr>)}</tbody></table></div> : <Empty title="每次运行，都会留下记录">发起首次回访，开始积累对用户的理解。</Empty>}</section>}
        {view === 'playbooks' && <div className="playbook-grid">{config?.playbooks.map((playbook, index) => <section className="panel playbook-card" key={playbook.id}><div className="playbook-top"><span className="book-number">0{index + 1}</span><span className="label-chip">演示业务</span></div><Icon name="book" size={32}/><h2>{playbook.name}</h2><p>{playbook.description}</p><h3>回访目标</h3><p>{playbook.goal}</p><h3>场景标签</h3><div className="label-row">{playbook.labels.map(label => <span className="label-chip" key={label.id}>{label.name}</span>)}</div><div className="playbook-rules">正文 {playbook.rules.minLength}–{playbook.rules.maxLength} 字 · 包含退订说明<br/>禁止：{playbook.rules.forbiddenPhrases.join('、')}</div></section>)}</div>}
        <footer>回响 Followup Agent <span>每一条反馈，都是下一次改进的起点。</span><span>本机运行 · 虚构数据</span></footer>
      </main>
    </div>
    {showStart && config && <StartDialog config={config} busy={busy} error={error} onClose={() => setShowStart(false)} onStart={(playbook, maxUsers) => void action(async () => { const result = await api<{ run: RunRecord }>('/runs', { playbook, maxUsers }); setDetail({ run: result.run, drafts: [], events: [], edits: [] }); setRuns(previous => [result.run, ...previous]); setSelectedId(result.run.id); setSelectedDraftId(undefined); setView('overview'); setShowStart(false); })}/>}
  </div>;
}

function EventPanel({ detail }: { detail?: RunDetail }) {
  return <section className="panel events-panel"><div className="panel-heading"><h2>运行事件</h2><span className="live-label"><i/>实时记录</span></div>{detail?.events.length ? <ol className="events">{detail.events.slice(-6).reverse().map(event => <li key={event.id} className={event.kind}><i/><div><span>{messages[event.code] ?? event.code}{event.code === 'STEP_STARTED' && ` · ${steps[event.step]}`}</span><small>{time(event.at)}{event.userId && ` · ${event.userId.slice(-6)}`}</small></div></li>)}</ol> : <div className="compact-empty">工作流开始后，执行事件会实时显示。</div>}<details className="full-events"><summary>查看完整事件记录{detail ? `（${detail.events.length}）` : ''}</summary><div>{detail?.events.map(event => <p key={event.id}><span className="mono">{time(event.at)}</span> {messages[event.code] ?? event.code} · {steps[event.step]}</p>)}</div></details></section>;
}

function DraftEditor({ draft, detail, busy, onReview }: { draft: Draft; detail: RunDetail; busy: boolean; onReview: (decision: 'approved' | 'rejected', subject: string, body: string) => void }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  useEffect(() => { setSubject(draft.subject); setBody(draft.body); }, [draft.id, draft.version]);
  const editable = draft.status === 'pending_approval' && detail.run.status === 'waiting_approval';
  const edits = detail.edits.filter(edit => edit.draftId === draft.id);
  return <section className="panel editor"><div className="panel-heading"><h2>审阅草稿</h2><Badge status={draft.status}/></div><div className="editor-meta"><span>匿名用户 <b className="mono">{draft.userId}</b></span><span>场景 <b>{draft.labelName}</b></span></div><div className="editor-form"><label htmlFor="draft-subject">邮件主题</label><input id="draft-subject" value={subject} maxLength={160} readOnly={!editable} onChange={event => setSubject(event.target.value)}/><label htmlFor="draft-body">邮件正文 <span>{body.length} 字</span></label><textarea id="draft-body" value={body} readOnly={!editable} onChange={event => setBody(event.target.value)} maxLength={detail.run.playbook.rules.maxLength} rows={12}/><p className="editor-note"><Icon name="shield" size={15}/>保留退订说明，不填写邮箱、姓名或电话。修改后会再次检查护栏。</p></div><div className="editor-bottom">{editable ? <><button className="button reject" disabled={busy} onClick={() => onReview('rejected', draft.subject, draft.body)}>拒绝草稿</button><div><button className="button" disabled={busy} onClick={() => { setSubject(draft.subject); setBody(draft.body); }}>还原修改</button><button className="button primary" disabled={busy} onClick={() => onReview('approved', subject, body)}><Icon name="check" size={16}/>批准草稿</button></div></> : <span className="muted">{draft.receiptId ? `模拟凭据：${draft.receiptId}` : '当前草稿为只读状态。'}</span>}</div><details className="audit"><summary>原始草稿与人工记录（{edits.length}）</summary><h4>原始主题</h4><p>{draft.originalSubject}</p><h4>原始正文</h4><pre>{draft.originalBody}</pre>{edits.map(edit => <div key={edit.id}><h4>{time(edit.at)} · {statuses[edit.decision]}</h4><p>{edit.after.subject}</p><pre>{edit.after.body}</pre></div>)}</details></section>;
}

function StartDialog({ config, busy, error, onClose, onStart }: { config: Config; busy: boolean; error: string; onClose: () => void; onStart: (playbook: string, maxUsers: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [playbook, setPlaybook] = useState(config.defaultPlaybook);
  const [maxUsers, setMaxUsers] = useState(Math.min(6, config.limits.maxUsers));
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="start-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="start-title"><form onSubmit={event => { event.preventDefault(); onStart(playbook, maxUsers); }}><div className="dialog-heading"><span className="empty-icon"><Icon name="play" size={24}/></span><button type="button" aria-label="关闭" className="icon-button" disabled={busy} onClick={onClose}><Icon name="close"/></button></div><h2 id="start-title">发起一次新的回访</h2><p>选择业务手册，Agent 将自动生成草稿并等待你的审批。</p><label htmlFor="playbook">业务手册</label><select id="playbook" value={playbook} onChange={event => setPlaybook(event.target.value)}>{config.playbooks.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><label htmlFor="max-users">本次用户数上限</label><input id="max-users" type="number" min={1} max={config.limits.maxUsers} required value={maxUsers} onChange={event => setMaxUsers(Number(event.target.value))}/><small>已进入其他回访任务的用户会自动跳过。</small><div className="dialog-notice"><Icon name="shield" size={18}/><span>本次使用虚构用户与模拟模型。<br/>审批后仅生成本地模拟发送记录。</span></div>{error && <div className="alert" role="alert">{error}</div>}<button className="button primary full-width" type="submit" disabled={busy}>{busy ? '正在创建…' : '开始回访'}<Icon name="arrow" size={17}/></button></form></dialog>;
}
