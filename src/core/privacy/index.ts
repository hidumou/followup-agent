import { AppError } from '../domain/index.ts';
import type { UserContext } from '../domain/index.ts';

const email = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const phone = /(?<!\w)(?:\+?\d[\d ()-]{6,}\d)(?!\w)/g;
const url = /https?:\/\/\S+/gi;
const labeledName = /(?:姓名|联系人|name)\s*[:：]\s*[^\n,，;；]+/gi;

export function redact(text: string): string {
  return text.replace(email, '[EMAIL]').replace(phone, '[PHONE]').replace(url, '[URL]').replace(labeledName, '[NAME]');
}
export function containsPii(text: string): boolean { return redact(text) !== text; }

export function anonymousContext(input: UserContext, allowedFeatures: string[]): UserContext {
  if (!/^usr_[a-f0-9]{12}$/.test(input.userId)) throw new AppError('INVALID_OPAQUE_ID');
  const features: UserContext['features'] = {};
  for (const key of allowedFeatures) {
    if (/email|name|phone|contact|address|token|key/i.test(key)) throw new AppError('PRIVATE_FEATURE');
    const value = input.features[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) features[key] = value;
  }
  return { userId: input.userId, features };
}
