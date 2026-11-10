import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Draft, Playbook, UserContext, UserRef } from '../../core/domain/index.ts';
import { AppError } from '../../core/domain/index.ts';
import type { DraftFiles, DraftModel, Mailer, UserSource } from '../../core/ports/index.ts';

export class MockUserSource implements UserSource {
  private users: UserContext[];
  constructor(users: UserContext[]) { this.users = structuredClone(users); }
  async listChurned({ limit }: { limit: number }): Promise<UserRef[]> { return this.users.slice(0, limit).map(({ userId }) => ({ userId })); }
  async getContext(userId: string): Promise<UserContext> {
    const found = this.users.find(user => user.userId === userId);
    if (!found) throw new AppError('USER_NOT_FOUND');
    return structuredClone(found);
  }
  async getContact(): Promise<never> { throw new AppError('CONTACT_UNAVAILABLE_IN_MOCK'); }
}
export async function loadMockUsers(path: string): Promise<UserContext[]> { return JSON.parse(await readFile(path, 'utf8')) as UserContext[]; }

export class StubModel implements DraftModel {
  readonly mode = 'stub' as const;
  async classify(context: UserContext, playbook: Playbook): Promise<string> {
    const label = playbook.labels.find(item => !item.feature || (typeof context.features[item.feature] === 'number' && Number(context.features[item.feature]) < (item.lessThan ?? Infinity)));
    if (!label) throw new AppError('NO_MATCHING_LABEL');
    return label.id;
  }
  async draft(_context: UserContext, labelId: string, playbook: Playbook): Promise<{ subject: string; body: string }> {
    const label = playbook.labels.find(item => item.id === labelId);
    if (!label) throw new AppError('INVALID_LABEL');
    return { subject: label.subject, body: label.body };
  }
}

export class FileMailer implements Mailer, DraftFiles {
  private root: string;
  constructor(root: string) { this.root = root; }
  private async write(directory: string, key: string, content: unknown): Promise<void> {
    const folder = join(this.root, directory);
    await mkdir(folder, { recursive: true });
    const target = join(folder, `${key}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(content, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  }
  async saveDraft(draft: Draft): Promise<void> { await this.write('drafts', draft.id, draft); }
  async simulate(draft: Draft): Promise<{ receiptId: string }> {
    const receiptId = `dry-run-${draft.id}`;
    await this.write('simulated', draft.id, { receiptId, mode: 'dry-run', userId: draft.userId, subject: draft.subject, body: draft.body });
    return { receiptId };
  }
}
