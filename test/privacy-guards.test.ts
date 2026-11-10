import { describe, expect, it } from 'vitest';
import { anonymousContext, redact } from '../src/core/privacy/index.ts';
import { assertBudget, checkDraft } from '../src/core/guards/index.ts';
import { loadPlaybooks } from '../src/runtime/playbooks.ts';
import { readEnv, resolveProjectRoot } from '../src/runtime/env.ts';

const playbook = (await loadPlaybooks(new URL('../playbooks', import.meta.url).pathname))[0];

describe('privacy boundary', () => {
  it('projects only approved numeric and boolean features into model context', () => {
    const input = { userId: 'usr_000000000001', features: { sessions: 3, consent: true, email: 'fiction@example.test', fullName: 'Fictional Person', rawText: 'Private message', invalid: NaN }, email: 'fiction@example.test' };
    const result = anonymousContext(input as never, ['sessions', 'consent', 'rawText', 'invalid']);
    expect(result).toEqual({ userId: 'usr_000000000001', features: { sessions: 3, consent: true } });
    expect(JSON.stringify(result)).not.toContain('fiction');
    expect(() => anonymousContext(input as never, ['email'])).toThrow('PRIVATE_FEATURE');
    expect(() => anonymousContext({ userId: 'fiction@example.test', features: {} }, [])).toThrow('INVALID_OPAQUE_ID');
  });
  it('redacts supported contact patterns before downstream use', () => {
    const result = redact('Name: Fictional Person\nfiction@example.test +1 (202) 555-0199 https://example.test/private');
    expect(result).toBe('[NAME]\n[EMAIL] [PHONE] [URL]');
    expect(redact('课程内容需要更清晰。')).toBe('课程内容需要更清晰。');
  });
});

describe('deterministic guards', () => {
  it('resolves the project when Mastra Studio changes the working directory', () => {
    const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    expect(resolveProjectRoot(`${root}/src/mastra/public`)).toBe(root);
  });
  const draft = { subject: playbook.labels[0].subject, body: playbook.labels[0].body };
  it('accepts the playbook template and rejects privacy leaks and forbidden promises', () => {
    expect(checkDraft(draft, playbook)).toEqual([]);
    expect(checkDraft({ ...draft, body: draft.body + 'fiction@example.test' }, playbook)).toContain('PII_DETECTED');
    expect(checkDraft({ ...draft, body: draft.body + '保证永久免费' }, playbook)).toContain('FORBIDDEN_PROMISE');
    expect(checkDraft({ ...draft, body: draft.body.replace(playbook.rules.requiredText, '') }, playbook)).toContain('MISSING_UNSUBSCRIBE');
    expect(checkDraft({ ...draft, body: '短' }, playbook)).toContain('INVALID_LENGTH');
    expect(checkDraft({ ...draft, subject: 'subject\nBcc: fiction@example.test' }, playbook)).toContain('INVALID_SUBJECT');
  });
  it('checks bounds before a model call can start', () => {
    const limits = { maxUsers: 2, maxCalls: 4, dailyTokens: 100 };
    const usage = { modelCalls: 3, llmCalls: 0, inputTokens: 0, outputTokens: 0 };
    expect(() => assertBudget(limits, usage, 2, 90, 10)).not.toThrow();
    expect(() => assertBudget(limits, { ...usage, modelCalls: 4 }, 2, 0)).toThrow('CALL_LIMIT');
    expect(() => assertBudget(limits, usage, 3, 0)).toThrow('USER_LIMIT');
    expect(() => assertBudget(limits, usage, 2, 90, 11)).toThrow('TOKEN_LIMIT');
  });
  it('fails closed for live or real adapters and hides invalid environment values', () => {
    expect(() => readEnv('/tmp', { SEND_MODE: 'live' })).toThrow('Invalid environment: SEND_MODE');
    expect(() => readEnv('/tmp', { ADAPTER_PROFILE: 'real' })).toThrow('Invalid environment: ADAPTER_PROFILE');
    expect(() => readEnv('/tmp', { DB_URL: 'https://private.invalid' })).toThrow('Invalid environment: DB_URL');
    expect(() => readEnv('/tmp', { MAX_USERS_PER_RUN: '0' })).toThrow();
  });
});
