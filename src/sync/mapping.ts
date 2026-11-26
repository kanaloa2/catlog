import type { TableName } from '../db';

/** Postgres table for each local table. */
export const REMOTE_TABLE: Record<TableName, string> = {
  cats: 'catlog_cats',
  events: 'catlog_events',
};

/** The fields that sync, per table (local camelCase names). Anything else stays local. */
export const COLUMNS: Record<TableName, readonly string[]> = {
  cats: ['id', 'name', 'isSomebody', 'notes', 'birthday', 'color', 'sortOrder', 'archived', 'photo', 'createdAt', 'updatedAt'],
  events: ['id', 'number', 'type', 'catIds', 'occurredAt', 'notes', 'source', 'photo', 'createdAt', 'updatedAt'],
};

export const HAS_PHOTO: Record<TableName, boolean> = {
  cats: true,
  events: true,
};

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

type Row = Record<string, unknown>;

/** Text columns that are NOT NULL on the server: missing locally = ''. */
const TEXT = new Set(['notes', 'birthday', 'color', 'source']);
const BOOL = new Set(['isSomebody', 'archived']);
const DEFAULTS: Record<string, unknown> = { sortOrder: 0, catIds: [] };

function emptyValue(k: string): unknown {
  if (TEXT.has(k)) return '';
  if (BOOL.has(k)) return false;
  if (k in DEFAULTS) return DEFAULTS[k];
  return null;
}

/**
 * Local row → Postgres row. user_id is deliberately omitted: the database fills it
 * from the signed-in user (auth.uid()), and RLS rejects any attempt to set someone else's.
 */
export function toRemote(table: TableName, row: Row): Row {
  const out: Row = {};
  for (const k of COLUMNS[table]) {
    let v = row[k];
    if (v === undefined || v === null) v = emptyValue(k);
    out[toSnake(k)] = v;
  }
  return out;
}

/** Postgres row → local row. */
export function fromRemote(table: TableName, row: Row): Row {
  const out: Row = {};
  for (const k of COLUMNS[table]) {
    const v = row[toSnake(k)];
    if (v === null || v === undefined) {
      if (k === 'photo') continue; // absent photo = no property, as created locally
      out[k] = emptyValue(k);
    } else if (k === 'number' || k === 'sortOrder') {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : emptyValue(k);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export { toSnake, toCamel };
