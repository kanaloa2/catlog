import Dexie, { type EntityTable } from 'dexie';
import type { Cat, CatEvent } from './types';

export class CatLogDB extends Dexie {
  cats!: EntityTable<Cat, 'id'>;
  events!: EntityTable<CatEvent, 'id'>;
  /** Local changes waiting to be pushed to the server, in the order they happened. */
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  /** Photos by storage path (content-addressed), so each is uploaded/downloaded once. */
  photoCache!: EntityTable<PhotoCacheEntry, 'path'>;
  /** Small key/value store, e.g. which user's data this device holds. */
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'catlog') {
    super(name);
    this.version(1).stores({
      cats: 'id, name',
      events: 'id, occurredAt, *catIds, type, number',
      outbox: '++seq',
      photoCache: 'path',
      meta: 'key',
    });
  }
}

export interface OutboxEntry {
  seq?: number;
  table: TableName;
  key: string;
}

export interface PhotoCacheEntry {
  path: string;
  dataUrl: string;
}

export interface MetaEntry {
  key: string;
  value: string;
}

export const db = new CatLogDB();

/** The user-data tables, parents before children (the order rows must be created in). */
export const ALL_TABLES = ['cats', 'events'] as const;
export type TableName = (typeof ALL_TABLES)[number];

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback (the server column is a uuid).
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
