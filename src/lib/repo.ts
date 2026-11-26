import { db, newId } from '../db';
import type { Cat, CatEvent } from '../types';
import { LOCAL_DT, nowLocal } from './format';
import { normalizeType } from './eventTypes';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

// ---------- cats ----------

/**
 * The built-in Somebody cat. Its id is the account's user id, so every device (and the
 * shortcut and email endpoints) agree on it without coordinating.
 */
export async function ensureSomebody(userId: string): Promise<void> {
  const existing = await db.cats.filter((c) => c.isSomebody).first();
  if (existing) return;
  const now = Date.now();
  await db.cats.put({
    id: userId,
    name: 'Somebody',
    isSomebody: true,
    notes: 'For when you don’t know who did it yet. Tap “Who did it?” on the event later to change it.',
    birthday: '',
    color: '',
    sortOrder: 1000,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
}

export async function somebodyId(): Promise<string | undefined> {
  return (await db.cats.filter((c) => c.isSomebody).first())?.id;
}

export interface CatInput {
  name: string;
  notes?: string;
  birthday?: string;
  color?: string;
  photo?: string;
  archived?: boolean;
}

function catFields(input: CatInput) {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Give the cat a name.', 'name');
  if (name.length > 60) throw new ValidationError('That name is too long.', 'name');
  const birthday = (input.birthday ?? '').trim();
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new ValidationError('Pick a birthday or leave it empty.', 'birthday');
  return { name, notes: (input.notes ?? '').trim(), birthday, color: (input.color ?? '').trim() };
}

export async function createCat(input: CatInput): Promise<Cat> {
  const fields = catFields(input);
  const all = await db.cats.toArray();
  if (all.some((c) => c.name.toLowerCase() === fields.name.toLowerCase())) throw new ValidationError(`You already have a cat named ${fields.name}.`, 'name');
  const now = Date.now();
  const maxOrder = Math.max(0, ...all.filter((c) => !c.isSomebody).map((c) => c.sortOrder));
  const cat: Cat = {
    id: newId(),
    ...fields,
    isSomebody: false,
    sortOrder: maxOrder + 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...(input.photo ? { photo: input.photo } : {}),
  };
  await db.cats.add(cat);
  return cat;
}

export async function updateCat(id: string, input: CatInput): Promise<void> {
  const existing = await db.cats.get(id);
  if (!existing) throw new ValidationError('That cat no longer exists.');
  const fields = catFields(input);
  const clash = await db.cats.filter((c) => c.id !== id && c.name.toLowerCase() === fields.name.toLowerCase()).first();
  if (clash) throw new ValidationError(`You already have a cat named ${fields.name}.`, 'name');
  const next: Cat = { ...existing, ...fields, archived: input.archived ?? existing.archived, updatedAt: Date.now() };
  if (input.photo) next.photo = input.photo;
  else delete next.photo;
  await db.cats.put(next);
}

/** Moves a cat one place earlier (-1) or later (+1) in the cat row. */
export async function moveCat(id: string, dir: -1 | 1): Promise<void> {
  const cats = (await db.cats.toArray()).filter((c) => !c.archived).sort(byOrder);
  const i = cats.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  const now = Date.now();
  await db.transaction('rw', db.cats, async () => {
    for (let k = 0; k < cats.length; k++) if (cats[k].sortOrder !== k) await db.cats.update(cats[k].id, { sortOrder: k, updatedAt: now });
  });
}

export function byOrder(a: Cat, b: Cat): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Deletes a cat. Its events stay: the cat is taken off them, and events left with nobody
 * go to Somebody. The Somebody cat can't be deleted.
 */
export async function deleteCat(id: string): Promise<void> {
  const cat = await db.cats.get(id);
  if (!cat) return;
  if (cat.isSomebody) throw new ValidationError('Somebody is built in and can’t be deleted.');
  const sb = await somebodyId();
  const now = Date.now();
  await db.transaction('rw', [db.cats, db.events], async () => {
    const events = await db.events.where('catIds').equals(id).toArray();
    for (const e of events) {
      let catIds = e.catIds.filter((c) => c !== id);
      if (!catIds.length && sb) catIds = [sb];
      await db.events.update(e.id, { catIds, updatedAt: now });
    }
    await db.cats.delete(id);
  });
}

// ---------- events ----------

export async function nextNumber(): Promise<number> {
  const last = await db.events.orderBy('number').last();
  return (last?.number ?? 0) + 1;
}

export interface EventInput {
  type: string;
  catIds: string[];
  occurredAt?: string;
  notes?: string;
  photo?: string;
  source?: string;
}

async function eventFields(input: EventInput) {
  const type = normalizeType(input.type);
  if (type.length > 40) throw new ValidationError('That event type is too long.', 'type');
  const occurredAt = (input.occurredAt ?? '').trim() || nowLocal();
  if (!LOCAL_DT.test(occurredAt)) throw new ValidationError('Pick when it happened.', 'occurredAt');
  let catIds = [...new Set(input.catIds)];
  if (!catIds.length) {
    const sb = await somebodyId();
    if (sb) catIds = [sb];
  }
  if (!catIds.length) throw new ValidationError('Pick who did it.', 'catIds');
  // Somebody plus a real cat means the real cat.
  const cats = await db.cats.bulkGet(catIds);
  if (cats.some((c) => !c)) throw new ValidationError('One of those cats no longer exists.', 'catIds');
  if (cats.length > 1) catIds = cats.filter((c) => !c!.isSomebody).map((c) => c!.id);
  return { type, occurredAt, catIds, notes: (input.notes ?? '').trim() };
}

export async function addEvent(input: EventInput): Promise<CatEvent> {
  const fields = await eventFields(input);
  const now = Date.now();
  const e: CatEvent = {
    id: newId(),
    number: await nextNumber(),
    ...fields,
    source: input.source ?? 'app',
    createdAt: now,
    updatedAt: now,
    ...(input.photo ? { photo: input.photo } : {}),
  };
  await db.events.add(e);
  return e;
}

export async function updateEvent(id: string, input: EventInput): Promise<void> {
  const existing = await db.events.get(id);
  if (!existing) throw new ValidationError('That event no longer exists.');
  const next: CatEvent = { ...existing, ...(await eventFields(input)), updatedAt: Date.now() };
  if (input.photo) next.photo = input.photo;
  else delete next.photo;
  await db.events.put(next);
}

/** Changes who did it. An empty list means Somebody. */
export async function setEventCats(id: string, catIds: string[]): Promise<void> {
  const existing = await db.events.get(id);
  if (!existing) throw new ValidationError('That event no longer exists.');
  const { catIds: clean } = await eventFields({ ...existing, catIds });
  await db.events.update(id, { catIds: clean, updatedAt: Date.now() });
}

export async function deleteEvent(id: string): Promise<CatEvent | undefined> {
  const e = await db.events.get(id);
  await db.events.delete(id);
  return e;
}

/** Puts back an event that was just deleted (Undo). */
export async function restoreEvent(e: CatEvent): Promise<void> {
  await db.events.put({ ...e, updatedAt: Date.now() });
}

/** Deletes every cat and event in this account, on every device. */
export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', [db.cats, db.events], async () => {
    await db.events.clear();
    // Somebody stays: shortcuts and email fall back to it.
    await db.cats.filter((c) => !c.isSomebody).delete();
  });
}
