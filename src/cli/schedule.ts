import { createContainer } from '../runtime/container.ts';
import { installRunner, runnerStatus, uninstallRunner, wakeRunner } from '../adapters/launchd/scheduler.ts';

async function main() {
  const command = process.argv[2];
  if (!['install', 'status', 'uninstall'].includes(command)) throw new Error('INVALID_SCHEDULE_COMMAND');
  const app = await createContainer();
  try {
    let { schedule } = await app.store.getSchedule();
    if (command === 'install') {
      await installRunner(app.config);
      schedule = await app.store.setScheduleEnabled(true, schedule.version);
      await wakeRunner(app.config);
    }
    if (command === 'uninstall') {
      schedule = await app.store.setScheduleEnabled(false, schedule.version);
      await uninstallRunner(app.config);
    }
    console.log(JSON.stringify({ schedule, runner: await runnerStatus(app.config, true) }, null, 2));
  } finally { await app.close(); }
}
try { await main(); }
catch { console.error('SCHEDULE_SETUP_FAILED'); process.exitCode = 1; }
