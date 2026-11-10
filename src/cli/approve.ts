import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createContainer } from '../runtime/container.ts';

const app = await createContainer();
const terminal = createInterface({ input: stdin, output: stdout });
try {
  const run = (await app.store.listRuns()).find(item => item.status === 'waiting_approval');
  if (!run) console.log('没有待审批的运行。');
  else {
    for (const draft of (await app.store.getRun(run.id)).drafts.filter(item => item.status === 'pending_approval')) {
      console.log(`\n${draft.userId}\n${draft.subject}\n${draft.body}\n`);
      const choice = await terminal.question('批准 [a] / 拒绝 [r] / 编辑后批准 [e] / 退出 [q]：');
      if (choice === 'q') break;
      if (!['a', 'r', 'e'].includes(choice)) continue;
      const subject = choice === 'e' ? (await terminal.question('主题（留空保留）：')) || draft.subject : draft.subject;
      const body = choice === 'e' ? (await terminal.question('正文（使用 \\n 换行，留空保留）：')).replaceAll('\\n', '\n') || draft.body : draft.body;
      await app.review(run.id, draft.id, { version: draft.version, decision: choice === 'r' ? 'rejected' : 'approved', subject, body });
    }
    const result = await app.wait(run.id);
    console.log(`运行状态：${result.run.status}；仅模拟发送。`);
  }
} finally { terminal.close(); await app.close(); }
