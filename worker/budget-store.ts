import type { BudgetReservation } from './app';

export const DAILY_DRAFT_LIMIT = 60;
export const BUDGET_SCHEMA = `
  CREATE TABLE IF NOT EXISTS draft_budget (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    day TEXT NOT NULL,
    used INTEGER NOT NULL CHECK (used >= 0)
  )
`;

export const RESERVE_DRAFT_SQL = `
  INSERT INTO draft_budget (singleton, day, used) VALUES (1, ?, 1)
  ON CONFLICT (singleton) DO UPDATE SET
    day = excluded.day,
    used = CASE WHEN draft_budget.day = excluded.day THEN draft_budget.used + 1 ELSE 1 END
  WHERE draft_budget.day <> excluded.day OR draft_budget.used < ?
  RETURNING used
`;

export type BudgetQuery = (sql: string, ...bindings: (string | number)[]) => Iterable<{ used: number }>;

/** One conditional SQL statement reserves capacity atomically, before any inference starts. */
export function reserveDailyDraft(query: BudgetQuery, now = new Date()): BudgetReservation {
  const day = now.toISOString().slice(0, 10);
  const resetAt = new Date(`${day}T00:00:00.000Z`);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  const row = Array.from(query(RESERVE_DRAFT_SQL, day, DAILY_DRAFT_LIMIT))[0];
  return {
    allowed: row !== undefined,
    remaining: row ? DAILY_DRAFT_LIMIT - row.used : 0,
    resetAt: resetAt.toISOString(),
  };
}
