import { DurableObject } from 'cloudflare:workers';
import { BUDGET_SCHEMA, reserveDailyDraft } from './budget-store';
import type { BudgetReservation } from './app';

/**
 * One named coordinator is intentional for this low-volume public demo's global allowance.
 * Only a day and a counter are persisted; requests and evidence are never stored here.
 */
export class DraftBudget extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(BUDGET_SCHEMA);
  }

  async reserve(): Promise<BudgetReservation> {
    return reserveDailyDraft((sql, ...bindings) =>
      this.ctx.storage.sql.exec<{ used: number }>(sql, ...bindings),
    );
  }
}
