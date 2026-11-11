import { createContainer } from '../runtime/container.ts';

// Each tick uses the persisted calendar; there is deliberately no force/catch-up flag.
async function tick() {
  const app = await createContainer();
  let closing: Promise<void> | undefined;
  const close = () => { closing ??= app.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    const run = await app.tickSchedule();
    if (run) {
      const result = await app.wait(run.id);
      console.log(JSON.stringify({ trigger: 'scheduled', runId: run.id, status: result.run.status, mode: 'dry-run' }));
    }
  } finally {
    process.removeListener('SIGINT', close);
    process.removeListener('SIGTERM', close);
    close();
    await closing;
  }
}
try { await tick(); }
catch { console.error('SCHEDULE_TICK_FAILED'); process.exitCode = 1; }
