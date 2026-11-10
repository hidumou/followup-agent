import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Playbook } from '../core/domain/index.ts';

const schema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string(), description: z.string(), goal: z.string(),
  allowedFeatures: z.array(z.string()),
  labels: z.array(z.object({ id: z.string(), name: z.string(), feature: z.string().optional(), lessThan: z.number().optional(), subject: z.string(), body: z.string() })).min(1),
  rules: z.object({ minLength: z.number().positive(), maxLength: z.number().positive(), requiredText: z.string(), forbiddenPhrases: z.array(z.string()) }),
});
export async function loadPlaybooks(root: string): Promise<Playbook[]> {
  const result: Playbook[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'default') continue;
    const parsed = schema.parse(JSON.parse(await readFile(join(root, entry.name, 'playbook.json'), 'utf8')));
    if (parsed.id !== entry.name) throw new Error('PLAYBOOK_DIRECTORY_MISMATCH');
    result.push(parsed);
  }
  return result;
}
