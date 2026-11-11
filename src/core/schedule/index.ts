export interface FollowupSchedule {
  id: 'weekday-followup';
  enabled: boolean;
  version: number;
  timezone: 'Asia/Taipei';
  weekdays: [1, 2, 3, 4, 5];
  hour: 9;
  minute: 0;
  missedPolicy: 'skip';
  nextRunAt: string | null;
  lastTickAt: string | null;
}
export interface ScheduleOccurrence {
  plannedAt: string;
  observedAt: string;
  outcome: 'started' | 'skipped' | 'failed';
  reason?: 'MISSED_WINDOW' | 'RUN_ALREADY_ACTIVE' | 'TRIGGER_FAILED';
  runId?: string;
}
export interface ScheduleSnapshot {
  schedule: FollowupSchedule;
  occurrences: ScheduleOccurrence[];
}

// This MVP supports the agreed Taipei calendar only, with no holiday calendar.
export function nextWeekdayRun(after: string): string {
  const instant = new Date(after);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  const candidate = new Date(`${date}T09:00:00+08:00`);
  for (let i = 0; i < 8; i++) {
    const weekday = candidate.getUTCDay();
    if (candidate > instant && weekday >= 1 && weekday <= 5) return candidate.toISOString();
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  throw new Error('INVALID_SCHEDULE_TIME');
}

export function initialSchedule(): FollowupSchedule {
  return { id: 'weekday-followup', enabled: false, version: 1, timezone: 'Asia/Taipei', weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0, missedPolicy: 'skip', nextRunAt: null, lastTickAt: null };
}
