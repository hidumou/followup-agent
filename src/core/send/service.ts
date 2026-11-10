import { AppError } from '../domain/index.ts';
import type { Draft, Playbook } from '../domain/index.ts';
import type { Mailer } from '../ports/index.ts';
import { checkDraft } from '../guards/index.ts';

export class SendService {
  private mailer: Mailer;
  constructor(mailer: Mailer) { this.mailer = mailer; }
  async simulate(draft: Draft, playbook: Playbook): Promise<{ receiptId: string }> {
    if (draft.status !== 'approved') throw new AppError('APPROVAL_REQUIRED', 409);
    if (checkDraft(draft, playbook).length) throw new AppError('GUARD_REJECTED');
    return this.mailer.simulate(draft);
  }
}
