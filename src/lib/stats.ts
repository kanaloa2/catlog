import type { CatEvent } from '../types';
import { LOCAL_DT, nowLocal } from './format';

export interface CatStats {
  total: number;
  byType: [string, number][];
  last?: CatEvent;
  last30: number;
  thisMonth: number;
}

/** Counts for one cat's events (already filtered to that cat), newest first or any order. */
export function catStats(events: CatEvent[], now = new Date()): CatStats {
  const byType = new Map<string, number>();
  let last: CatEvent | undefined;
  const month = nowLocal(now).slice(0, 7);
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const cut = nowLocal(cutoff);
  let last30 = 0;
  let thisMonth = 0;
  for (const e of events) {
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    if (!last || e.occurredAt > last.occurredAt) last = e;
    if (LOCAL_DT.test(e.occurredAt)) {
      if (e.occurredAt >= cut) last30++;
      if (e.occurredAt.startsWith(month)) thisMonth++;
    }
  }
  return { total: events.length, byType: [...byType].sort((a, b) => b[1] - a[1]), last, last30, thisMonth };
}

/** Event count per cat id. An event with two cats counts for both. */
export function countsByCat(events: CatEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) for (const id of e.catIds) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}
