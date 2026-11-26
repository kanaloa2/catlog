import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { byOrder } from './lib/repo';
import type { Cat } from './types';

/** All cats in cat-row order (Somebody last). Includes archived ones; filter where needed. */
export function useCats() {
  return useLiveQuery(async () => (await db.cats.toArray()).sort(byOrder), []);
}

export function useCatsById(cats: Cat[] | undefined) {
  return useMemo(() => new Map((cats ?? []).map((c) => [c.id, c])), [cats]);
}

/** Every event, newest first. */
export function useEvents() {
  return useLiveQuery(() => db.events.orderBy('occurredAt').reverse().toArray(), []);
}

/** Events on days from `from` to `to` (YYYY-MM-DD, inclusive). */
export function useEventsBetween(from: string, to: string) {
  return useLiveQuery(() => db.events.where('occurredAt').between(from, to + 'T99', true, true).sortBy('occurredAt'), [from, to]);
}

/** undefined = loading, null = not found */
export function useEvent(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.events.get(id)) ?? null) : null), [id]);
}

export function useCat(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.cats.get(id)) ?? null) : null), [id]);
}

export function useCatEvents(id: string | undefined) {
  return useLiveQuery(async () => (id ? (await db.events.where('catIds').equals(id).sortBy('occurredAt')).reverse() : []), [id]);
}
