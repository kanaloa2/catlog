import { describe, expect, it } from 'vitest';
import { db } from '../db';
import * as repo from '../lib/repo';
import { applyPlan, buildPlan, guessColumns, guessTables, numberOf, parseTitle, preferLinkedEventTable, stableId, type Mapping, type TableMeta } from './catImporter';
import type { DataverseConfig } from './config';

const cfg: DataverseConfig = { envUrl: 'https://x.crm.dynamics.com', clientId: '', tenantId: '' };

const catMeta: TableMeta = {
  logicalName: 'cr1_kitty',
  displayName: 'Kitty',
  entitySet: 'cr1_kitties',
  primaryId: 'cr1_kittyid',
  primaryName: 'cr1_name',
  columns: [
    { name: 'cr1_name', label: 'Name', type: 'String' },
    { name: 'cr1_notes', label: 'Notes', type: 'Memo' },
    { name: 'cr1_birthday', label: 'Birthday', type: 'DateTime' },
  ],
  image: { column: 'cr1_picture', full: true },
  links: [],
};
const eventMeta: TableMeta = {
  logicalName: 'cr1_kittyevent',
  displayName: 'Kitty Event',
  entitySet: 'cr1_kittyevents',
  primaryId: 'cr1_kittyeventid',
  primaryName: 'cr1_title',
  columns: [
    { name: 'cr1_title', label: 'Title', type: 'String' },
    { name: 'cr1_kitty', label: 'Kitty', type: 'Lookup', targets: ['cr1_kitty'] },
    { name: 'cr1_kitty2', label: 'Kitty 2', type: 'Lookup', targets: ['cr1_kitty'] },
    { name: 'cr1_eventtype', label: 'Event Type', type: 'Picklist' },
    { name: 'cr1_when', label: 'When', type: 'DateTime' },
    { name: 'cr1_eventnumber', label: 'Event Number', type: 'String' },
    { name: 'cr1_notes', label: 'Notes', type: 'Memo' },
    { name: 'createdon', label: 'Created On', type: 'DateTime' },
  ],
  image: null,
  links: [],
};

describe('guessing', () => {
  it('finds the cat and event tables', () => {
    const t = (logicalName: string, displayName: string) => ({ logicalName, displayName, entitySet: logicalName + 's', isCustom: true });
    expect(guessTables([t('cr1_kittyevent', 'Kitty Event'), t('cr1_kitty', 'Kitty'), t('cr1_trip', 'Trip')])).toEqual({
      catTable: 'cr1_kitty',
      eventTable: 'cr1_kittyevent',
    });
  });
  it('skips Microsoft tables and prefers the cats table publisher', () => {
    const t = (logicalName: string, displayName: string) => ({ logicalName, displayName, entitySet: logicalName + 's', isCustom: true });
    const list = [t('msdyn_aievent', 'AI Event'), t('cr282_cat', 'Cat'), t('cr282_poop', 'Poop'), t('cr9_event', 'Event'), t('adx_webpage', 'Web Page')];
    expect(guessTables(list)).toEqual({ catTable: 'cr282_cat', eventTable: 'cr282_poop' });
    expect(guessTables([...list, t('cr282_catevent', 'Cat Event')])).toEqual({ catTable: 'cr282_cat', eventTable: 'cr282_catevent' });
  });
  it('never guesses a Microsoft events table, and prefers one that looks up the cats', () => {
    const t = (logicalName: string, displayName: string) => ({ logicalName, displayName, entitySet: logicalName + 's', isCustom: true });
    const list = [t('msdyn_aievent', 'AI Event'), t('cr282_cat', 'Cat'), t('cr282_mess', 'Kitty Stuff'), t('cr282_food', 'Food')];
    expect(guessTables(list).eventTable).toBe('cr282_mess');
    const two = [t('msdyn_aievent', 'AI Event'), t('cr282_cat', 'Cat'), t('cr282_a', 'Alpha'), t('cr282_b', 'Beta')];
    expect(guessTables(two).eventTable).toBe('');
    expect(preferLinkedEventTable(two, ['msdyn_aievent', 'cr282_b'], '')).toBe('cr282_b');
  });
  it('matches columns', () => {
    const g = guessColumns(catMeta, eventMeta);
    expect(g.cat).toMatchObject({ name: 'cr1_name', birthday: 'cr1_birthday', notes: 'cr1_notes' });
    expect(g.event).toMatchObject({ cat1: 'cr1_kitty', cat2: 'cr1_kitty2', type: 'cr1_eventtype', occurredAt: 'cr1_when', number: 'cr1_eventnumber', notes: 'cr1_notes' });
  });
});

describe('reading values', () => {
  it('parses titles', () => {
    expect(parseTitle('Stormy & The Bandit Pooed')).toEqual({ names: ['Stormy', 'The Bandit'], type: 'Pooed' });
    expect(parseTitle('Somebody barfed')).toEqual({ names: ['Somebody'], type: 'Barfed' });
  });
  it('reads numbers from autonumbers', () => {
    expect(numberOf({ n: 'EV-3512' }, 'n')).toBe(3512);
    expect(numberOf({ n: 42 }, 'n')).toBe(42);
  });
});

describe('import', () => {
  it('maps lookups, Somebody and titles, and numbers events without one', async () => {
    await repo.ensureSomebody('u1');
    const existing = await repo.createCat({ name: 'Stormy' });
    const m: Mapping = { catTable: 'cr1_kitty', eventTable: 'cr1_kittyevent', ...guessColumns(catMeta, eventMeta) };
    const F = '@OData.Community.Display.V1.FormattedValue';
    const src = {
      cats: [
        { cr1_kittyid: 'k1', cr1_name: 'Stormy', cr1_birthday: '2019-04-02T00:00:00Z' },
        { cr1_kittyid: 'k2', cr1_name: 'The Bandit', cr1_pictureid: 'img' },
        { cr1_kittyid: 'k3', cr1_name: 'Unknown' },
      ],
      events: [
        { cr1_kittyeventid: 'e1', cr1_title: 'x', _cr1_kitty_value: 'k1', _cr1_kitty2_value: 'k2', cr1_eventtype: 1, [`cr1_eventtype${F}`]: 'Poop', cr1_when: '2026-11-25T18:22:00Z', cr1_eventnumber: '3512' },
        { cr1_kittyeventid: 'e2', cr1_title: 'Somebody Barfed', _cr1_kitty_value: 'k3', cr1_when: '2026-11-24T10:00:00Z' },
        { cr1_kittyeventid: 'e3', cr1_title: 'Luna Peed', cr1_when: '2026-11-23T10:00:00Z' },
      ],
    };
    const plan = await buildPlan(src, m, { cat: catMeta, event: eventMeta }, 'u1');
    expect(plan.photos).toHaveLength(1);
    const r = await applyPlan(cfg, plan, { includePhotos: false });
    expect(r.merged).toBe(1);
    const cats = await db.cats.toArray();
    expect(cats.map((c) => c.name).sort()).toEqual(['Luna', 'Somebody', 'Stormy', 'The Bandit']);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const events = (await db.events.toArray()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const names = (ids: string[]) => ids.map((id) => byId.get(id)!.name);
    expect(events.map((e) => [names(e.catIds), e.type, e.number])).toEqual([
      [['Luna'], 'Peed', 3513],
      [['Somebody'], 'Barfed', 3514],
      [['Stormy', 'The Bandit'], 'Pooed', 3512],
    ]);
    expect(events[2].catIds[0]).toBe(existing.id);
    expect((await db.cats.get(existing.id))?.birthday).toMatch(/^2019-04-0[12]$/);
    // Importing again updates instead of duplicating.
    await applyPlan(cfg, await buildPlan(src, m, { cat: catMeta, event: eventMeta }, 'u1'), { includePhotos: false });
    expect(await db.events.count()).toBe(3);
    expect(await db.cats.count()).toBe(4);
  });
  it('treats a "Stormy & The Bandit" cat as both cats, and prefers a clear title over an odd type', async () => {
    await repo.ensureSomebody('u1');
    const m: Mapping = { catTable: 'cr1_kitty', eventTable: 'cr1_kittyevent', ...guessColumns(catMeta, eventMeta) };
    const F = '@OData.Community.Display.V1.FormattedValue';
    const src = {
      cats: [
        { cr1_kittyid: 'k1', cr1_name: 'Stormy' },
        { cr1_kittyid: 'k2', cr1_name: 'The Bandit' },
        { cr1_kittyid: 'k4', cr1_name: 'Stormy & The Bandit' },
      ],
      events: [
        { cr1_kittyeventid: 'e1', cr1_title: 'Stormy & The Bandit Barfed', _cr1_kitty_value: 'k4', cr1_eventtype: 9, [`cr1_eventtype${F}`]: 'Text', cr1_when: '2026-11-25T18:22:00Z' },
      ],
    };
    // An earlier import made the pair a cat of its own.
    const comboId = await stableId('dv-cat|k4');
    await db.cats.put({ id: comboId, name: 'Stormy & The Bandit', isSomebody: false, notes: '', birthday: '', color: '', sortOrder: 5, archived: false, createdAt: 1, updatedAt: 1 });
    const plan = await buildPlan(src, m, { cat: catMeta, event: eventMeta }, 'u1');
    expect(plan.cats.map((c) => c.name)).toEqual(['Stormy', 'The Bandit']);
    await applyPlan(cfg, plan, { includePhotos: false });
    const cats = await db.cats.toArray();
    expect(cats.map((c) => c.name).sort()).toEqual(['Somebody', 'Stormy', 'The Bandit']);
    const byId = new Map(cats.map((c) => [c.id, c.name]));
    const [e] = await db.events.toArray();
    expect([e.catIds.map((id) => byId.get(id)), e.type]).toEqual([['Stormy', 'The Bandit'], 'Barfed']);
  });
});
