import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db';
import * as repo from '../lib/repo';
import { SyncEngine } from './engine';
import { FakeSupabase } from '../test/fakeSupabase';

let server: FakeSupabase;
const client = { current: new FakeSupabase() };
const proxy = new Proxy({} as SupabaseClient, {
  get: (_t, prop) => {
    const v = (client.current as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client.current) : v;
  },
});
const engine = new SyncEngine(db, proxy, { realtime: false, timers: false, pushDelayMs: 60_000, pullDelayMs: 60_000 });
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  server = new FakeSupabase();
  client.current = server;
  await engine.start('u1');
});

afterEach(async () => {
  await engine.stop();
});

describe('sync engine', () => {
  it('pushes cats and events, with the cat list as an array', async () => {
    await repo.ensureSomebody('u1');
    const a = await repo.createCat({ name: 'Stormy' });
    const b = await repo.createCat({ name: 'The Bandit' });
    const e = await repo.addEvent({ type: 'poop', catIds: [a.id, b.id], occurredAt: '2026-11-25T11:22' });
    await settle();
    await engine.syncNow();
    expect(server.table('catlog_cats').get(a.id)).toMatchObject({ name: 'Stormy', is_somebody: false });
    expect(server.table('catlog_cats').get('u1')).toMatchObject({ name: 'Somebody', is_somebody: true });
    expect(server.table('catlog_events').get(e.id)).toMatchObject({ type: 'Pooed', cat_ids: [a.id, b.id], occurred_at: '2026-11-25T11:22', number: 1 });
  });

  it('pulls a change of cat made on another device', async () => {
    await repo.ensureSomebody('u1');
    const a = await repo.createCat({ name: 'Stormy' });
    const e = await repo.addEvent({ type: 'Barfed', catIds: [] });
    await settle();
    await engine.syncNow();
    const row = server.table('catlog_events').get(e.id)!;
    row.cat_ids = [a.id];
    row.updated_at = Date.now() + 1000;
    await engine.syncNow();
    expect((await db.events.get(e.id))?.catIds).toEqual([a.id]);
  });

  it('uploads cat photos and restores them on a fresh device', async () => {
    const photo = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes');
    const c = await repo.createCat({ name: 'Luna', photo });
    await settle();
    await engine.syncNow();
    expect(server.table('catlog_cats').get(c.id)?.photo).toMatch(/^u1\/[0-9a-f]{64}\.jpg$/);
    await engine.stop();
    await engine.silently(async () => {
      await db.cats.clear();
    });
    await db.photoCache.clear();
    await engine.start('u1');
    expect((await db.cats.get(c.id))?.photo).toBe(photo);
  });

  it('does not record changes while signed out', async () => {
    await engine.stop();
    await repo.createCat({ name: 'Local only' });
    await settle();
    expect(await db.outbox.count()).toBe(0);
  });
});
