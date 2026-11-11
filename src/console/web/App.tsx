import { useEffect, useRef, useState } from 'react';
import { Activity, BookOpen, CheckSquare, ClipboardList, FileChartColumn, LayoutDashboard, Lightbulb, MessageSquare, Monitor, Moon, Plus, Settings, Sun, X } from 'lucide-react';
import type { Config, QueueItem, ScheduleData, View, WorkspaceData } from './types.ts';
import type { RunRecord } from '../../core/domain/index.ts';
import { api } from './api.ts';
import { errorText } from './copy.ts';
import { Budget, Panel, Skeleton, Version } from './components/Common.tsx';
import { Overview } from './pages/Overview.tsx';
import { Followups } from './pages/Followups.tsx';
import { Approvals } from './pages/Approvals.tsx';
import { Runs } from './pages/Runs.tsx';
import s from './console.module.css';
const nav = [{
  id: 'overview',
  label: '工作台',
  icon: LayoutDashboard
}, {
  id: 'followups',
  label: '回访任务',
  icon: ClipboardList
}, {
  id: 'approvals',
  label: '草稿审批',
  icon: CheckSquare
}, {
  id: 'replies',
  label: '回复与洞察',
  icon: MessageSquare,
  milestone: 'M3'
}, {
  id: 'reports',
  label: '报告',
  icon: FileChartColumn,
  milestone: 'M4'
}, {
  id: 'playbooks',
  label: 'Playbook',
  icon: BookOpen
}, {
  id: 'proposals',
  label: '建议',
  icon: Lightbulb,
  milestone: 'M6'
}, {
  id: 'runs',
  label: '运行与评估',
  icon: Activity
}, {
  id: 'settings',
  label: '设置',
  icon: Settings,
  milestone: 'M1'
}];
const descriptions: Record<View, string> = {
  overview: '查看今日回访进展，处理需要你关注的事项。',
  followups: '以用户为单位追踪回访，从发现到审批与模拟发送。',
  approvals: '检查回访内容与护栏，决定是否批准。',
  playbooks: '查看当前业务规则、场景标签与回访目标。',
  runs: '追踪执行步骤、模型用量和自动回访计划。'
};
export function App() {
  const [view, setView] = useState<View>('overview'),
    [data, setData] = useState<WorkspaceData>(),
    [connection, setConnection] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [start, setStart] = useState(false);
  const [selectedRun, setSelectedRun] = useState<string>(),
    [selectedDraft, setSelectedDraft] = useState<string>(),
    [selectedBook, setSelectedBook] = useState<string>(),
    [runTab, setRunTab] = useState<'history' | 'schedule'>('history');
  const [revision, setRevision] = useState(0);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('followup.theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('followup.theme', theme);
    } catch {/* Preference storage is optional. */}
  }, [theme]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const [config, overview, runs, queue, schedule] = await Promise.all([api<Config>('/config', undefined, controller.signal), api<WorkspaceData['overview']>('/overview', undefined, controller.signal), api<{
          runs: RunRecord[];
        }>('/runs', undefined, controller.signal), api<{
          queue: QueueItem[];
        }>('/approvals', undefined, controller.signal), api<ScheduleData>('/schedule', undefined, controller.signal)]);
        if (!controller.signal.aborted) {
          setData({
            config,
            overview,
            runs: runs.runs,
            queue: queue.queue,
            schedule
          });
          setConnection('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setConnection(errorText(e));
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2500);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  const lock = useRef(false);
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setRevision(value => value + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const navigate = (next: View) => {
    setView(next);
    setError('');
    setNotice('');
    setSelectedRun(undefined);
  };
  const openRun = (id: string) => {
    setSelectedRun(id);
    setRunTab('history');
    setView('runs');
  };
  const openSchedule = () => {
    setSelectedRun(undefined);
    setRunTab('schedule');
    setView('runs');
  };
  const openApproval = (id?: string) => {
    setSelectedDraft(id);
    setView('approvals');
  };
  const openBook = (id: string) => {
    setSelectedBook(id);
    setView('playbooks');
  };
  const runAction = (kind: 'cancel' | 'retry', id: string) => void action(async () => {
    await api(`/runs/${id}/${kind}`, {});
    setNotice(kind === 'retry' ? '已提交人工重试。' : '已请求停止运行。');
  });
  const active = data?.runs.some(run => ['queued', 'running', 'waiting_approval'].includes(run.status));
  const defaultBook = data?.config.playbooks.find(book => book.id === data.config.defaultPlaybook);
  return <><a className={s.skip} href="#main">跳至主要内容</a><header className={s.topbar}><a href="#" className={s.brand} onClick={event => {
        event.preventDefault();
        navigate('overview');
      }}><Activity /><strong>回访</strong><span>Agent 控制台</span></a><div className={s.topControls}><span className={s.badge}>DRY-RUN</span>{defaultBook && <button className={s.topBook} onClick={() => openBook(defaultBook.id)}>{defaultBook.name}<Version value={defaultBook.version} /></button>}{data && <Budget tokens={data.overview.tokens} limit={data.config.limits.dailyTokens} compact />}<label className={s.theme}>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}<select aria-label="外观主题" value={theme} onChange={event => setTheme(event.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div></header><aside className={s.sidebar}><span className={s.navCaption}>工作空间</span><nav aria-label="主导航">{nav.map(item => <button key={item.id} disabled={!!item.milestone} title={item.milestone ? `${item.label} · ${item.milestone} 阶段提供` : item.label} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id as View)}><item.icon /><span>{item.label}</span>{item.milestone ? <small>{item.milestone}</small> : item.id === 'approvals' && !!data?.queue.length ? <b className={s.count}>{data.queue.length}</b> : null}</button>)}</nav><div className={s.navFoot}><span className={s.statusDot} /><span>本地工作空间<small>M0 · 模拟发送</small></span></div></aside><main id="main" className={s.main}><div className={s.pageHead}><div><h1>{nav.find(item => item.id === view)?.label}</h1><p>{descriptions[view]}</p></div>{['overview', 'followups', 'runs'].includes(view) && <button className={s.primary} disabled={!data || !!connection || !!active || busy} title={active ? '先处理或停止当前运行' : undefined} onClick={() => {
          setError('');
          setStart(true);
        }}><Plus />发起回访</button>}</div>{connection && <p className={s.error} role="alert">{connection} 页面数据可能不是最新。</p>}{error && !start && <p className={s.error} role="alert">{error}<button className={s.iconButton} aria-label="关闭错误提示" onClick={() => setError('')}><X /></button></p>}{notice && <p className={s.notice} role="status">{notice}</p>}{!data ? <Skeleton /> : <>{view === 'overview' && <Overview data={data} onRun={openRun} onApprove={() => openApproval()} onSchedule={openSchedule} onFollowups={() => navigate('followups')} />}{view === 'followups' && <Followups playbooks={data.config.playbooks} onRun={openRun} onApprove={openApproval} onPlaybook={openBook} />}{view === 'approvals' && <Approvals queue={data.queue} selected={selectedDraft} onSelect={setSelectedDraft} busy={busy || !!connection} onReview={(item, decision, subject, body) => void action(async () => {
          await api(`/runs/${item.run.id}/drafts/${item.draft.id}/review`, {
            version: item.draft.version,
            decision,
            subject,
            body
          });
          setNotice(decision === 'approved' ? '草稿已批准。全部审批完成后，运行会继续模拟发送。' : '草稿已拒绝。');
        })} />}{view === 'runs' && <Runs runs={data.runs} selected={selectedRun} onSelect={setSelectedRun} tab={runTab} onTab={setRunTab} schedule={data.schedule} busy={busy || !!connection} onAction={runAction} onSchedule={() => void action(async () => {
          await api('/schedule', {
            enabled: !data.schedule.schedule.enabled,
            version: data.schedule.schedule.version
          });
        })} />}{view === 'playbooks' && <Playbooks config={data.config} selected={selectedBook} onSelect={setSelectedBook} />}</>}<footer className={s.footer}>回访 Agent · 本地控制台<span>时间均为 Asia/Taipei</span></footer></main>{start && data && <StartDialog config={data.config} busy={busy} error={error} onClose={() => setStart(false)} onStart={(playbook, maxUsers) => void action(async () => {
      const {
        run
      } = await api<{
        run: RunRecord;
      }>('/runs', {
        playbook,
        maxUsers
      });
      setStart(false);
      openRun(run.id);
    })} />}</>;
}
function Playbooks({
  config,
  selected,
  onSelect
}: {
  config: Config;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const book = config.playbooks.find(item => item.id === selected) ?? config.playbooks[0];
  return <><div className={s.tabs} role="tablist" aria-label="Playbook">{config.playbooks.map(item => <button role="tab" aria-selected={item.id === book.id} key={item.id} onClick={() => onSelect(item.id)}>{item.name}</button>)}</div><Panel title={book.name} aside={<Version value={book.version} />}><div className={s.reading}><p>{book.description}</p><h3>回访目标</h3><p>{book.goal}</p><h3>内容护栏</h3><dl className={s.facts}><div><dt>正文长度</dt><dd>{book.rules.minLength}–{book.rules.maxLength} 字符</dd></div><div><dt>必须包含</dt><dd>{book.rules.requiredText}</dd></div><div><dt>禁止承诺</dt><dd>{book.rules.forbiddenPhrases.join('、') || '无'}</dd></div></dl><p className={s.note}>当前仅展示已加载规则。版本历史与编辑将在 M1 接入；历史回访保留运行时快照。</p></div></Panel><Panel title="场景标签"><div className={s.tableWrap}><table><thead><tr><th>标签</th><th>规则 ID</th><th>回访主题</th></tr></thead><tbody>{book.labels.map(label => <tr key={label.id}><td>{label.name}</td><td className={s.mono}>{label.id}</td><td>{label.subject}</td></tr>)}</tbody></table></div></Panel></>;
}
function StartDialog({
  config,
  busy,
  error,
  onClose,
  onStart
}: {
  config: Config;
  busy: boolean;
  error: string;
  onClose: () => void;
  onStart: (playbook: string, maxUsers: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [playbook, setPlaybook] = useState(config.defaultPlaybook),
    [maxUsers, setMaxUsers] = useState(Math.min(6, config.limits.maxUsers));
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return <dialog className={s.dialog} ref={ref} aria-labelledby="start-title" onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }}><form onSubmit={event => {
      event.preventDefault();
      onStart(playbook, maxUsers);
    }}><div className={s.panelHead}><h2 id="start-title">发起回访</h2><button className={s.iconButton} type="button" aria-label="关闭" onClick={onClose} disabled={busy}><X /></button></div><p className={s.muted}>发现模拟用户，生成回访草稿，并停在人工审批。</p><label className={s.field}>Playbook<select value={playbook} onChange={e => setPlaybook(e.target.value)} disabled={busy}>{config.playbooks.map(book => <option key={book.id} value={book.id}>{book.name} · v{book.version}</option>)}</select></label><label className={s.field}>本次用户上限<input type="number" min={1} max={config.limits.maxUsers} required value={maxUsers} onChange={e => setMaxUsers(Number(e.target.value))} disabled={busy} /></label><p className={s.notice}>{config.model.mode === 'llm' ? `将调用真实 AI（${config.model.writer}），计入累计 $${config.budgetUsd.toFixed(2)} 预算。` : '本次使用离线模拟模型，不产生 AI 费用。'}每次最多调用 {config.limits.maxCalls} 次。</p>{error && <p className={s.error} role="alert">{error}</p>}<div className={s.editorActions}><button className={s.button} type="button" onClick={onClose} disabled={busy}>取消</button><button className={s.primary} type="submit" disabled={busy}>{busy ? '正在发起…' : '开始回访'}</button></div></form></dialog>;
}
