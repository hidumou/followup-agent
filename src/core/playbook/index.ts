import { AppError } from '../domain/index.ts';
import type { Playbook } from '../domain/index.ts';

export function getPlaybook(playbooks: Playbook[], id: string): Playbook {
  const playbook = playbooks.find(item => item.id === id);
  if (!playbook) throw new AppError('PLAYBOOK_NOT_FOUND', 404);
  return structuredClone(playbook);
}
