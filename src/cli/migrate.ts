import { createContainer } from '../runtime/container.ts';

const app = await createContainer();
console.log('SQLite migration complete.');
await app.close();
