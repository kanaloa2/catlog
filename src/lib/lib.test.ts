import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from './repo';
import { eventTitle, joinNames, normalizeType } from './eventTypes';
import { catStats } from './stats';
import { resolveCats, splitNames } from '../pages/AddPage';
import { filterEvents, type EventFilter } from '../pages/EventsPage';

async function setup() {
  await repo.ensureSomebody('u1');
  const stormy = await repo.createCat({ name: 'Stormy' });
  const bandit = await repo.createCat({ name: 'The Bandit' });
  return { stormy, bandit, byId: new Map((await db.cats.toArray()).map((c) => [c.id, c])) };
}

describe('event types', () => {
  it('normalizes the words people use', () => {
    expect(normalizeType('poop')).toBe('Pooed');
    expect(normalizeType('PUKED')).toBe('Barfed');
    expect(normalizeType('threw up')).toBe('Barfed');
    expect(normalizeType('💦')).toBe('Peed');
    expect(normalizeType('zoomies')).toBe('Zoomies');
    expect(normalizeType('')).toBe('Pooed');
  });
  it('joins names like the calendar', () => {
    expect(joinNames(['Stormy', 'The Bandit'])).toBe('Stormy & The Bandit');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B & C');
  });
});

describe('repo', () => {
  it('numbers events and titles them', async () => {
    const { stormy, bandit, byId } = await setup();
    const a = await repo.addEvent({ type: 'poo', catIds: [stormy.id, bandit.id] });
    const b = await repo.addEvent({ type: 'barf', catIds: [] });
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(eventTitle(a, byId)).toBe('Stormy & The Bandit Pooed');
    expect(eventTitle(b, byId)).toBe('Somebody Barfed');
  });

  it('changes Somebody to a real cat, and drops Somebody when both are picked', async () => {
    const { stormy } = await setup();
    const e = await repo.addEvent({ type: 'Pooed', catIds: [] });
    expect(e.catIds).toEqual(['u1']);
    await repo.setEventCats(e.id, ['u1', stormy.id]);
    expect((await db.events.get(e.id))?.catIds).toEqual([stormy.id]);
    await repo.setEventCats(e.id, []);
    expect((await db.events.get(e.id))?.catIds).toEqual(['u1']);
  });

  it('deleting a cat hands its solo events to Somebody', async () => {
    const { stormy, bandit } = await setup();
    const solo = await repo.addEvent({ type: 'Pooed', catIds: [stormy.id] });
    const both = await repo.addEvent({ type: 'Pooed', catIds: [stormy.id, bandit.id] });
    await repo.deleteCat(stormy.id);
    expect((await db.events.get(solo.id))?.catIds).toEqual(['u1']);
    expect((await db.events.get(both.id))?.catIds).toEqual([bandit.id]);
    await expect(repo.deleteCat('u1')).rejects.toThrow();
  });

  it('refuses a duplicate cat name', async () => {
    await setup();
    await expect(repo.createCat({ name: 'stormy' })).rejects.toThrow();
  });

  it('counts a cat’s events', async () => {
    const { stormy } = await setup();
    await repo.addEvent({ type: 'Pooed', catIds: [stormy.id] });
    await repo.addEvent({ type: 'Pooed', catIds: [stormy.id] });
    await repo.addEvent({ type: 'Barfed', catIds: [stormy.id], occurredAt: '2020-01-01T08:00' });
    const s = catStats(await db.events.where('catIds').equals(stormy.id).toArray());
    expect(s.total).toBe(3);
    expect(s.byType).toEqual([
      ['Pooed', 2],
      ['Barfed', 1],
    ]);
    expect(s.last30).toBe(2);
  });
});

describe('deep links', () => {
  it('splits and finds cats by name', async () => {
    const { stormy, bandit } = await setup();
    const cats = await db.cats.toArray();
    expect(splitNames('stormy & bandit')).toEqual(['stormy', 'bandit']);
    expect(splitNames('Stormy, The Bandit and Luna')).toEqual(['Stormy', 'The Bandit', 'Luna']);
    const r = resolveCats(['stormy', 'bandit', 'Luna', 'somebody'], cats);
    expect(r.found.map((c) => c.id)).toEqual([stormy.id, bandit.id, 'u1']);
    expect(r.missing).toEqual(['Luna']);
  });
});

describe('search and filters', () => {
  it('filters by cat, type, date, unknown and text', async () => {
    const { stormy, bandit, byId } = await setup();
    const a = await repo.addEvent({ type: 'Pooed', catIds: [stormy.id], occurredAt: '2026-11-01T09:00', notes: 'by the door' });
    const b = await repo.addEvent({ type: 'Barfed', catIds: [bandit.id], occurredAt: '2026-11-10T09:00' });
    const c = await repo.addEvent({ type: 'Pooed', catIds: [], occurredAt: '2026-11-20T09:00' });
    const all = await db.events.toArray();
    const f = (p: Partial<EventFilter>) =>
      filterEvents(all, { q: '', cats: [], types: [], from: '', to: '', unknown: false, ...p }, byId)
        .map((e) => e.id)
        .sort();
    expect(f({ cats: [stormy.id] })).toEqual([a.id]);
    expect(f({ types: ['Pooed'] })).toEqual([a.id, c.id].sort());
    expect(f({ from: '2026-11-05', to: '2026-11-15' })).toEqual([b.id]);
    expect(f({ unknown: true })).toEqual([c.id]);
    expect(f({ q: 'door' })).toEqual([a.id]);
    expect(f({ q: 'bandit barfed' })).toEqual([b.id]);
    expect(f({ q: `#${c.number}` })).toEqual([c.id]);
  });
});
