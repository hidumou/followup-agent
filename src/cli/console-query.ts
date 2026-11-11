import { createContainer } from '../runtime/container.ts';
import { AppError } from '../core/domain/index.ts';
const [command, ...raw] = process.argv.slice(2);
const args = raw.filter(value => value !== '--');
const app = await createContainer();
try {
  const {
    queries,
    operations
  } = app.services;
  let result: unknown;
  if (command === 'status' && args.length === 0) result = await queries.overview();else if (command === 'followups' && (!args.length || args[0] === 'list')) result = await queries.followups();else if (command === 'followups' && args[0] === 'show' && args[1]) result = await queries.followup(args[1]);else if (command === 'runs' && (!args.length || args[0] === 'list')) result = await queries.listRuns();else if (command === 'runs' && args[0] === 'show' && args[1]) result = await queries.getRun(args[1]);else if (command === 'runs' && args[0] === 'retry' && args[1]) {
    await operations.retry(args[1]);
    result = await app.wait(args[1]);
  } else if (command === 'runs' && args[0] === 'cancel' && args[1]) {
    await operations.cancel(args[1]);
    result = await app.wait(args[1]);
  } else throw new AppError('INVALID_COMMAND');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof AppError ? error.code : 'COMMAND_FAILED');
  process.exitCode = 1;
} finally {
  await app.close();
}
