import { createClient } from '@libsql/client';
import type { Client, Transaction, InValue, Row } from '@libsql/client';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '../../core/domain/index.ts';
import type { RunDetail, RunRecord } from '../../core/domain/index.ts';
import type { RecordStore } from '../../core/ports/index.ts';
import { initialSchedule, nextWeekdayRun } from '../../core/schedule/index.ts';
import type { FollowupSchedule, ScheduleOccurrence, ScheduleSnapshot } from '../../core/schedule/index.ts';

type Executor = Pick<Client, 'execute'> | Pick<Transaction, 'execute'>;
const decode = <T>(rows: Row[]): T[] => rows.map(row => JSON.parse(String(row.payload)) as T);
// Native SQLite waits block the event loop. Serialize local connections together;
// separate processes still coordinate through SQLite's write lock and constraints.
const writes = new Map<string, Promise<unknown>>();

export class SqliteRecordStore implements RecordStore {
  readonly client: Client;
  private readonly url: string;
  constructor(url: string) { this.url = url; this.client = createClient({ url }); }
  async init(migration: string): Promise<void> {
    await this.client.execute('PRAGMA journal_mode = WAL');
    await this.client.execute('PRAGMA busy_timeout = 5000');
    for (const file of (await readdir(dirname(migration))).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      await this.client.executeMultiple(await readFile(join(dirname(migration), file), 'utf8'));
    }
    await this.client.execute({ sql: 'INSERT OR IGNORE INTO schedules (id, payload) VALUES (?, ?)', args: ['weekday-followup', JSON.stringify(initialSchedule())] });
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = (writes.get(this.url) ?? Promise.resolve()).then(work);
    const settled = next.catch(() => undefined);
    writes.set(this.url, settled);
    void settled.finally(() => { if (writes.get(this.url) === settled) writes.delete(this.url); });
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
    const result = await this.client.execute('SELECT payload FROM runs');
    return decode<RunRecord>(result.rows).reduce((sum, run) => sum + (run.calls ?? []).filter(call => call.day === day).reduce((total, call) => total + call.inputTokens + call.outputTokens, 0), 0);
  }
  async totalCostUsd(): Promise<number> {
    const result = await this.client.execute('SELECT payload FROM runs');
    return decode<RunRecord>(result.rows).reduce((sum, run) => sum + (run.calls ?? []).reduce((total, call) => total + call.costUsd, 0), 0);
  }
  private async readSchedule(db: Executor): Promise<FollowupSchedule> {
    return decode<FollowupSchedule>((await db.execute("SELECT payload FROM schedules WHERE id = 'weekday-followup'")).rows)[0];
  }
  async getSchedule(): Promise<ScheduleSnapshot> {
    return this.exclusive(async () => ({
      schedule: await this.readSchedule(this.client),
      occurrences: decode<ScheduleOccurrence>((await this.client.execute("SELECT payload FROM schedule_occurrences WHERE schedule_id = 'weekday-followup' ORDER BY planned_at DESC LIMIT 100")).rows),
    }));
  }
  async setScheduleEnabled(enabled: boolean, version: number, now = new Date().toISOString()): Promise<FollowupSchedule> {
    return this.exclusive(async () => {
      const tx = await this.client.transaction('write');
      try {
        const schedule = await this.readSchedule(tx);
        if (schedule.version !== version) throw new AppError('SCHEDULE_VERSION_CONFLICT', 409);
        if (schedule.enabled !== enabled) {
          schedule.enabled = enabled;
          schedule.nextRunAt = enabled ? nextWeekdayRun(now) : null;
          schedule.version++;
          await tx.execute({ sql: 'UPDATE schedules SET payload = ? WHERE id = ?', args: [JSON.stringify(schedule), schedule.id] });
        }
        await tx.commit();
        return schedule;
      } catch (error) { await tx.rollback(); throw error; }
      finally { tx.close(); }
    });
  }
  async tickSchedule(prepare: (plannedAt: string) => RunRecord, at?: string): Promise<RunRecord | undefined> {
    return this.exclusive(async () => {
      const tx = await this.client.transaction('write');
      try {
        const now = at ?? new Date().toISOString();
        const schedule = await this.readSchedule(tx);
        schedule.lastTickAt = now;
        let started: RunRecord | undefined;
        while (schedule.enabled && schedule.nextRunAt && schedule.nextRunAt <= now) {
          const plannedAt = schedule.nextRunAt;
          schedule.nextRunAt = nextWeekdayRun(plannedAt);
          const occurrence: ScheduleOccurrence = { plannedAt, observedAt: now, outcome: 'skipped' };
          if (Date.parse(now) - Date.parse(plannedAt) >= 60_000) occurrence.reason = 'MISSED_WINDOW';
          else {
            const active = await tx.execute("SELECT id FROM runs WHERE status IN ('queued', 'running', 'waiting_approval') LIMIT 1");
            if (active.rows.length) occurrence.reason = 'RUN_ALREADY_ACTIVE';
            else {
              // Persist the occurrence, run and cursor in one transaction, before any model call.
              let run: RunRecord | undefined;
              try { run = prepare(plannedAt); }
              catch { occurrence.outcome = 'failed'; occurrence.reason = 'TRIGGER_FAILED'; }
              if (run) {
                await tx.execute({ sql: 'INSERT INTO runs (id, status, playbook, created_at, payload) VALUES (?, ?, ?, ?, ?)', args: [run.id, run.status, run.playbook.id, run.createdAt, JSON.stringify(run)] });
                const event = { id: `${run.id}-scheduled`, at: now, code: 'SCHEDULE_TRIGGERED', kind: 'info', step: 'discover' };
                await tx.execute({ sql: 'INSERT INTO run_events (id, run_id, payload) VALUES (?, ?, ?)', args: [event.id, run.id, JSON.stringify(event)] });
                occurrence.outcome = 'started';
                occurrence.runId = run.id;
                started = run;
              }
            }
          }
          await tx.execute({ sql: 'INSERT INTO schedule_occurrences (schedule_id, planned_at, payload) VALUES (?, ?, ?)', args: [schedule.id, plannedAt, JSON.stringify(occurrence)] });
        }
        await tx.execute({ sql: 'UPDATE schedules SET payload = ? WHERE id = ?', args: [JSON.stringify(schedule), schedule.id] });
        await tx.commit();
        return started;
      } catch (error) { await tx.rollback(); throw error; }
      finally { tx.close(); }
    });
  }
  close(): void { this.client.close(); }
}
