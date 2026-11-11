import { AppError } from '../domain/index.ts';
import type { Limits, Playbook, Usage } from '../domain/index.ts';
import { containsPii } from '../privacy/index.ts';

export function checkDraft(draft: { subject: string; body: string }, playbook: Playbook): string[] {
  const errors: string[] = [];
  const text = `${draft.subject}\n${draft.body}`;
  if (!draft.subject.trim() || draft.subject.length > 160 || /[\r\n]/.test(draft.subject)) errors.push('INVALID_SUBJECT');
  if (draft.body.trim().length < playbook.rules.minLength || draft.body.length > playbook.rules.maxLength) errors.push('INVALID_LENGTH');
  if (playbook.rules.requiredText && !draft.body.includes(playbook.rules.requiredText)) errors.push('MISSING_UNSUBSCRIBE');
  if (playbook.rules.forbiddenPhrases.some(phrase => text.toLowerCase().includes(phrase.toLowerCase()))) errors.push('FORBIDDEN_PROMISE');
  if (containsPii(text)) errors.push('PII_DETECTED');
  return errors;
}

export function assertBudget(limits: Limits, usage: Usage, users: number, dailyTokens: number, nextTokens = 0): void {
  if (users > limits.maxUsers) throw new AppError('USER_LIMIT');
  if (usage.modelCalls >= limits.maxCalls) throw new AppError('CALL_LIMIT');
  if (dailyTokens + nextTokens > limits.dailyTokens) throw new AppError('TOKEN_LIMIT');
}

export function assertCostBudget(used: number, next: number, limit: number): void {
  if (![used, next, limit].every(value => Number.isFinite(value) && value >= 0) || used + next > limit) throw new AppError('COST_LIMIT');
}
