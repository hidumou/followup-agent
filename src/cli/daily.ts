import { createContainer } from '../runtime/container.ts';

const app = await createContainer();
try {
  const run = await app.start();
  const result = await app.wait(run.id);
  console.log(JSON.stringify({ runId: run.id, status: result.run.status, drafts: result.drafts.length, mode: 'dry-run' }));
  if (result.run.status === 'failed') process.exitCode = 1;
} finally { await app.close(); }
