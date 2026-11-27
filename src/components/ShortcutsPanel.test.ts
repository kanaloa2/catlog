import { describe, expect, it } from 'vitest';
import { catPairs } from './ShortcutsPanel';
import type { Cat, CatEvent } from '../types';

const cat = (id: string, name: string, sortOrder: number, isSomebody = false): Cat => ({
  id, name, sortOrder, isSomebody, notes: '', birthday: '', color: '', archived: false, createdAt: 0, updatedAt: 0,
});
const ev = (catIds: string[]): CatEvent => ({ id: Math.random().toString(), number: null, type: 'Pooed', catIds, occurredAt: '2026-11-27T08:00', notes: '', source: 'app', createdAt: 0, updatedAt: 0 });

describe('catPairs', () => {
  it('finds cats that often go together', () => {
    const cats = [cat('s', 'Stormy', 1), cat('b', 'The Bandit', 0), cat('m', 'Samantha', 2), cat('u', 'Somebody', 1000, true)];
    const events = [...Array(4)].map(() => ev(['s', 'b'])).concat([ev(['m', 'b']), ev(['s']), ev(['s', 'u'])]);
    expect(catPairs(cats, events).map((p) => p.map((c) => c.name))).toEqual([['Stormy', 'The Bandit']]);
  });
});
