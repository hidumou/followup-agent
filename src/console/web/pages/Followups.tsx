import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { FollowupDetail, Playbook } from '../../../core/domain/index.ts';
import type { FollowupList } from '../types.ts';
import { api } from '../api.ts';
import { time, statuses, steps, messages, errorText } from '../copy.ts';
import { Back, Badge, Empty, Panel, Skeleton, Version } from '../components/Common.tsx';
import s from '../console.module.css';
export function Followups({
  playbooks,
  onRun,
  onApprove,
  onPlaybook
}: {
  playbooks: Playbook[];
  onRun: (id: string) => void;
  onApprove: (id: string) => void;
  onPlaybook: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [filters, setFilters] = useState({
    query: '',
    status: '',
    label: '',
    version: '',
    playbook: '',
    days: '',
    sort: 'newest',
    page: 1
  });
  const [data, setData] = useState<FollowupList>();
  const [detail, setDetail] = useState<FollowupDetail>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(undefined);
    setDetail(undefined);
    setError('');
    const refresh = async () => {
      try {
        if (selected) setDetail(await api<FollowupDetail>(`/followups/${encodeURIComponent(selected)}`, undefined, controller.signal));else {
          const query = new URLSearchParams();
          Object.entries(filters).forEach(([key, value]) => {
            if (value !== '') query.set(key, String(value));
          });
          setData(await api<FollowupList>(`/followups?${query}`, undefined, controller.signal));
        }
        setError('');
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2500);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [filters, selected]);
  const change = (key: string, value: string) => setFilters(previous => ({
    ...previous,
    [key]: value,
    page: 1
  }));
  if (selected) return <><Back onClick={() => setSelected(undefined)}>回访任务</Back>{error && <p className={s.error} role="alert">{error}</p>}{!detail ? <Skeleton /> : <><div className={s.detailHead}><div><h1 className={s.mono}>{detail.followup.userId}</h1><p>{detail.followup.playbookName} · <Version value={detail.followup.playbookVersion} onClick={() => onPlaybook(detail.followup.playbookId)} /></p></div><Badge status={detail.followup.status} /></div><div className={s.twoColumns}><Panel title="回访时间线"><ol className={s.timeline}>{detail.events.map(event => <li key={event.id}><span className={event.kind === 'error' ? s.danger : s.muted}>{time(event.at)}</span><div><strong>{messages[event.code] ?? event.code}</strong><small>{steps[event.step]}</small></div></li>)}</ol><button className={s.link} onClick={() => onRun(detail.run.id)}>查看完整运行与用量</button></Panel><div className={s.stack}><Panel title="匿名用户上下文">{detail.context ? <dl className={s.facts}>{Object.entries(detail.context.features).map(([key, value]) => <div key={key}><dt className={s.mono}>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : <p className={s.muted}>此历史记录未保存匿名上下文。</p>}<p className={s.note}>仅展示行为特征；联系方式不进入模型上下文。</p></Panel><Panel title="分类结果"><dl className={s.facts}><div><dt>场景标签</dt><dd>{detail.followup.labelName ?? '未分类'}</dd></div><div><dt>置信度</dt><dd>{detail.followup.confidence === null ? '未记录' : detail.followup.confidence}</dd></div><div><dt>发现时间</dt><dd>{time(detail.followup.discoveredAt)}</dd></div></dl></Panel></div></div><Panel title="回访草稿" aside={detail.draft?.status === 'pending_approval' && detail.run.status === 'waiting_approval' ? <button className={s.button} onClick={() => onApprove(detail.draft!.id)}>前往审批</button> : undefined}>{detail.draft ? <div className={s.reading}><h3>{detail.draft.subject}</h3><p className={s.prose}>{detail.draft.body}</p><p className={s.note}>人工处理 {detail.edits.length} 次 · {detail.draft.receiptId ? '模拟发送凭据已保存' : '尚无模拟发送凭据'}</p></div> : <Empty title="尚未生成草稿">查看运行状态，了解当前步骤。</Empty>}</Panel></>}</>;
  const labels = [...new Map(playbooks.flatMap(book => book.labels).map(label => [label.id, label])).values()];
  return <><div className={s.filters}><label className={s.search}><Search /><input aria-label="搜索匿名用户 ID" placeholder="搜索匿名用户 ID" value={filters.query} onChange={e => change('query', e.target.value)} /></label><select aria-label="回访状态" value={filters.status} onChange={e => change('status', e.target.value)}><option value="">全部状态</option>{['discovered', 'pending_approval', 'approved', 'rejected', 'simulated', 'failed', 'cancelled', 'interrupted'].map(value => <option key={value} value={value}>{statuses[value]}</option>)}</select><select aria-label="场景标签" value={filters.label} onChange={e => change('label', e.target.value)}><option value="">全部标签</option>{labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</select><select aria-label="业务手册" value={filters.playbook} onChange={e => change('playbook', e.target.value)}><option value="">全部 Playbook</option>{playbooks.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}</select><select aria-label="版本筛选" value={filters.version} onChange={e => change('version', e.target.value)}><option value="">全部版本</option><option value="legacy">版本未记录</option>{[...new Set([...playbooks.map(book => book.version), ...(data?.versions ?? [])])].filter(Boolean).map(version => <option key={version} value={version!}>v{version}</option>)}</select><select aria-label="发现时间" value={filters.days} onChange={e => change('days', e.target.value)}><option value="">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select><select aria-label="排序" value={filters.sort} onChange={e => change('sort', e.target.value)}><option value="newest">最新优先</option><option value="oldest">最早优先</option></select></div>{error && <p className={s.error} role="alert">{error}</p>}{!data ? <Skeleton /> : data.records.length ? <div className={s.panel}><div className={s.tableWrap}><table><thead><tr><th>匿名用户</th><th>场景标签</th><th>状态</th><th>Playbook</th><th>发现时间</th><th><span className={s.srOnly}>操作</span></th></tr></thead><tbody>{data.records.map(record => <tr key={record.id}><td className={s.mono}>{record.userId}</td><td>{record.labelName ?? '未分类'}</td><td><Badge status={record.status} /></td><td>{record.playbookName}<small><Version value={record.playbookVersion} onClick={() => onPlaybook(record.playbookId)} /></small></td><td>{time(record.discoveredAt)}</td><td><button className={s.link} onClick={() => setSelected(record.id)}>查看详情</button></td></tr>)}</tbody></table></div><div className={s.pagination}><span>共 {data.total} 条 · 第 {data.page} / {data.pages} 页</span><div className={s.actions}><button className={s.button} disabled={data.page <= 1} onClick={() => setFilters({
            ...filters,
            page: data.page - 1
          })}>上一页</button><button className={s.button} disabled={data.page >= data.pages} onClick={() => setFilters({
            ...filters,
            page: data.page + 1
          })}>下一页</button></div></div></div> : <Empty title="没有符合条件的回访记录">调整筛选条件，或发起一次回访。</Empty>}</>;
}
