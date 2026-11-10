import { createClient } from '@libsql/client';
import type { Client, Transaction, InValue, Row } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import { AppError } from '../../core/domain/index.ts';
import type { RunDetail, RunRecord } from '../../core/domain/index.ts';
import type { RecordStore } from '../../core/ports/index.ts';

type Executor = Pick<Client, 'execute'> | Pick<Transaction, 'execute'>;
const decode = <T>(rows: Row[]): T[] => rows.map(row => JSON.parse(String(row.payload)) as T);

export class SqliteRecordStore implements RecordStore {
  readonly client: Client;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(url: string) { this.client = createClient({ url }); }
  async init(migration: string): Promise<void> {
    await this.client.execute('PRAGMA journal_mode = WAL');
    await this.client.execute('PRAGMA busy_timeout = 5000');
    await this.client.executeMultiple(await readFile(migration, 'utf8'));
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }
  async createRun(run: RunRecord): Promise<void> {
    await this.exclusive(async () => {
      try {
        await this.client.execute({ sql: 'INSERT INTO runs (id, status, playbook, created_at, payload) VALUES (?, ?, ?, ?, ?)', args: [run.id, run.status, run.playbook.id, run.createdAt, JSON.stringify(run)] });
      } catch (error) {
        if (String(error).includes('UNIQUE constraint')) throw new AppError('RUN_ALREADY_ACTIVE', 409);
        throw new AppError('STORAGE_WRITE_FAILED', 500);
      }
    });
  }
  private async readDetail(db: Executor, id: string): Promise<RunDetail> {
    const result = await db.execute({ sql: 'SELECT payload FROM runs WHERE id = ?', args: [id] });
    if (!result.rows.length) throw new AppError('RUN_NOT_FOUND', 404);
    const rows = async <T>(table: string) => decode<T>((await db.execute({ sql: `SELECT payload FROM ${table} WHERE run_id = ? ORDER BY rowid`, args: [id] })).rows);
    return { run: decode<RunRecord>(result.rows)[0], drafts: await rows('drafts'), events: await rows('run_events'), edits: await rows('human_edits') };
  }
  async getRun(id: string): Promise<RunDetail> { return this.exclusive(() => this.readDetail(this.client, id)); }
  async listRuns(): Promise<RunRecord[]> {
    return this.exclusive(async () => decode<RunRecord>((await this.client.execute('SELECT payload FROM runs ORDER BY created_at DESC LIMIT 100')).rows));
  }
  async mutate(id: string, change: (detail: RunDetail) => void): Promise<RunDetail> {
    return this.exclusive(async () => {
      const tx = await this.client.transaction('write');
      try {
        const detail = await this.readDetail(tx, id);
        change(detail);
        const exec = async (sql: string, args: InValue[]) => { await tx.execute({ sql, args }); };
        await exec('UPDATE runs SET status = ?, payload = ? WHERE id = ?', [detail.run.status, JSON.stringify(detail.run), id]);
        for (const draft of detail.drafts) {
          await exec('INSERT INTO drafts (id, run_id, user_id, playbook, status, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload', [draft.id, id, draft.userId, detail.run.playbook.id, draft.status, JSON.stringify(draft)]);
        }
        for (const event of detail.events) await exec('INSERT OR IGNORE INTO run_events (id, run_id, payload) VALUES (?, ?, ?)', [event.id, id, JSON.stringify(event)]);
        for (const edit of detail.edits) await exec('INSERT OR IGNORE INTO human_edits (id, run_id, draft_id, payload) VALUES (?, ?, ?, ?)', [edit.id, id, edit.draftId, JSON.stringify(edit)]);
        await tx.commit();
        return detail;
      } catch (error) {
        await tx.rollback();
        if (String(error).includes('UNIQUE constraint')) throw new AppError('RUN_ALREADY_ACTIVE', 409);
        throw error;
      } finally { tx.close(); }
    });
  }
  async reservedUsers(playbook: string, exceptRun = ''): Promise<Set<string>> {
    const result = await this.client.execute({ sql: `SELECT DISTINCT d.user_id FROM drafts d JOIN runs r ON r.id = d.run_id WHERE d.playbook = ? AND d.run_id != ? AND (d.status = 'simulated' OR r.status != 'cancelled')`, args: [playbook, exceptRun] });
    return new Set(result.rows.map(row => String(row.user_id)));
  }
  async dailyTokens(day: string): Promise<number> {
    const result = await this.client.execute({ sql: "SELECT payload FROM runs WHERE substr(created_at, 1, 10) = ?", args: [day] });
    return decode<RunRecord>(result.rows).reduce((sum, run) => sum + run.usage.inputTokens + run.usage.outputTokens, 0);
  }
  close(): void { this.client.close(); }
}
