import { useEffect, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import type { QueueItem } from '../types.ts';
import { api } from '../api.ts';
import { errorText, time } from '../copy.ts';
import { Empty, GuardList, Version } from '../components/Common.tsx';
import s from '../console.module.css';
export function Approvals({
  queue,
  selected,
  onSelect,
  busy,
  onReview
}: {
  queue: QueueItem[];
  selected?: string;
  onSelect: (id: string) => void;
  busy: boolean;
  onReview: (item: QueueItem, decision: 'approved' | 'rejected', subject: string, body: string) => void;
}) {
  const item = queue.find(item => item.draft.id === selected) ?? queue[0];
  if (!item) return <Empty title="所有草稿已处理">新回访生成草稿后，会在这里等待人工审批。</Empty>;
  return <div className={s.approvalLayout}><aside className={s.queue} aria-label="待审批队列"><h2>待审批 <span className={s.count}>{queue.length}</span></h2>{queue.map(entry => <button key={entry.draft.id} className={`${s.queueItem} ${entry.draft.id === item.draft.id ? s.selected : ''}`} onClick={() => onSelect(entry.draft.id)}><strong className={s.mono}>{entry.draft.userId}</strong><span>{entry.draft.labelName}</span><small>{time(entry.draft.createdAt)} · {entry.run.playbook.name}</small></button>)}</aside><Editor key={`${item.draft.id}:${item.draft.version}`} item={item} busy={busy} onReview={onReview} /></div>;
}
function Editor({
  item,
  busy,
  onReview
}: {
  item: QueueItem;
  busy: boolean;
  onReview: (item: QueueItem, decision: 'approved' | 'rejected', subject: string, body: string) => void;
}) {
  const {
    draft,
    run
  } = item;
  const [subject, setSubject] = useState(draft.subject),
    [body, setBody] = useState(draft.body),
    [showDiff, setShowDiff] = useState(false);
  const [checked, setChecked] = useState<{
      key: string;
      errors: string[];
    }>(),
    [checkError, setCheckError] = useState('');
  const key = JSON.stringify([subject, body]);
  const checking = checked?.key !== key;
  useEffect(() => {
    const controller = new AbortController();
    setCheckError('');
    const timer = setTimeout(() => {
      void api<{
        errors: string[];
      }>(`/runs/${run.id}/guard-check`, {
        subject,
        body
      }, controller.signal).then(result => setChecked({
        key,
        errors: result.errors
      })).catch(error => {
        if (!controller.signal.aborted) setCheckError(errorText(error));
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [run.id, subject, body, key]);
  const changed = subject !== draft.subject || body !== draft.body;
  const diff = diffWordsWithSpace(`${draft.originalSubject}\n\n${draft.originalBody}`, `${subject}\n\n${body}`);
  return <section className={s.editor}><div className={s.panelHead}><div><h2 className={s.mono}>{draft.userId}</h2><p>{draft.labelName} · <Version value={draft.playbookVersion ?? run.playbook.version} /></p></div><span className={s.badge}>DRY-RUN</span></div><p className={s.note}>批准后执行模拟发送，并保存处理记录。</p><label className={s.field}>邮件主题<input value={subject} maxLength={160} onChange={event => setSubject(event.target.value)} disabled={busy} /></label><label className={s.field}>邮件正文<textarea value={body} maxLength={5000} onChange={event => setBody(event.target.value)} disabled={busy} rows={12} /></label><div className={s.panelHead}><span className={s.muted}>{body.length} 字符 · 要求 {run.playbook.rules.minLength}–{run.playbook.rules.maxLength}</span><button className={s.link} onClick={() => setShowDiff(!showDiff)} aria-expanded={showDiff}>{showDiff ? '收起差异' : '与 AI 原稿对比'}</button></div>{showDiff && <div className={s.diff} aria-label="草稿修改差异">{diff.map((part, index) => part.added ? <ins key={index}>{part.value}</ins> : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>}<GuardList checking={checking || !!checkError} errors={checked?.errors ?? []} />{checkError && <p className={s.error} role="alert">{checkError}</p>}<div className={s.editorActions}><button className={s.button} disabled={busy} onClick={() => onReview(item, 'rejected', draft.subject, draft.body)}>拒绝草稿</button><button className={s.primary} disabled={busy || checking || !!checkError || !!checked?.errors.length} onClick={() => onReview(item, 'approved', subject, body)}>{busy ? '正在处理…' : changed ? '编辑并批准' : '批准草稿'}</button></div></section>;
}
