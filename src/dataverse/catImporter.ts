import { db } from '../db';
import type { Cat, CatEvent } from '../types';
import { resizeImage } from '../lib/photo';
import { normalizeType } from '../lib/eventTypes';
import { describeTables, dvGet, dvGetAll, dvGetBlob, FORMATTED, type ColumnSummary, type DvDeps, type TableInfo } from './api';
import type { DataverseConfig } from './config';

/*
 * Import cats and kitty events from Dataverse.
 *
 * It doesn't assume a fixed schema. It finds a cats table and an events table by name, matches
 * their columns to CatLog's fields by name and type, and lets you change any choice before
 * importing:
 *
 *   Cat table    → Cat (name, notes, birthday, image)
 *   Event table  → Event (who: up to 3 cat lookups, a many-to-many link, or names in text;
 *                  type, when, event number, notes, image)
 *
 * When the event says nothing usable about who or what, its title ("Stormy & The Bandit Pooed")
 * is read instead. A cat called Somebody, Someone, Unknown or ? becomes CatLog's Somebody.
 */

type Json = Record<string, unknown>;

export const CAT_FIELDS = ['name', 'notes', 'birthday'] as const;
export type CatField = (typeof CAT_FIELDS)[number];
export const EVENT_FIELDS = ['cat1', 'cat2', 'cat3', 'catNames', 'type', 'occurredAt', 'number', 'notes'] as const;
export type EventField = (typeof EVENT_FIELDS)[number];

export const FIELD_LABELS: Record<CatField | EventField, string> = {
  name: 'Name',
  notes: 'Notes',
  birthday: 'Birthday',
  cat1: 'Cat (lookup)',
  cat2: 'Second cat (lookup)',
  cat3: 'Third cat (lookup)',
  catNames: 'Cat names (text)',
  type: 'What happened',
  occurredAt: 'When',
  number: 'Event number',
};

/** Which tables and columns to read. Column values are Dataverse logical names; '' = not imported. */
export interface Mapping {
  catTable: string;
  eventTable: string;
  cat: Partial<Record<CatField, string>>;
  event: Partial<Record<EventField, string>>;
  /** Navigation property of a many-to-many link from events to cats; '' = none. */
  catLink?: string;
}

export const EMPTY_MAPPING: Mapping = { catTable: '', eventTable: '', cat: {}, event: {}, catLink: '' };

export interface ImageColumn {
  column: string;
  full: boolean;
}

/** A many-to-many relationship, seen from this table. */
export interface LinkInfo {
  nav: string;
  with: string;
  name: string;
}

export interface TableMeta {
  logicalName: string;
  displayName: string;
  entitySet: string;
  primaryId: string;
  primaryName: string;
  columns: ColumnSummary[];
  image: ImageColumn | null;
  links: LinkInfo[];
}

// ---------- reading metadata ----------

async function imageColumn(c: DataverseConfig, table: string, deps: DvDeps): Promise<ImageColumn | null> {
  try {
    const res = await dvGet<{ value: Json[] }>(
      c,
      `EntityDefinitions(LogicalName='${table}')/Attributes/Microsoft.Dynamics.CRM.ImageAttributeMetadata?$select=LogicalName,CanStoreFullImage,IsPrimaryImage`,
      deps,
    );
    const cols = res.value ?? [];
    const pick = cols.find((a) => a.IsPrimaryImage === true) ?? cols[0];
    return pick ? { column: String(pick.LogicalName), full: pick.CanStoreFullImage === true } : null;
  } catch {
    return null;
  }
}

async function manyToMany(c: DataverseConfig, table: string, deps: DvDeps): Promise<LinkInfo[]> {
  try {
    const res = await dvGet<{ value: Json[] }>(
      c,
      `EntityDefinitions(LogicalName='${table}')/ManyToManyRelationships?$select=SchemaName,Entity1LogicalName,Entity2LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName`,
      deps,
    );
    return (res.value ?? []).map((r) => {
      const first = r.Entity1LogicalName === table;
      return {
        nav: String((first ? r.Entity1NavigationPropertyName : r.Entity2NavigationPropertyName) ?? r.SchemaName),
        with: String(first ? r.Entity2LogicalName : r.Entity1LogicalName),
        name: String(r.SchemaName),
      };
    });
  } catch {
    return [];
  }
}

export async function loadTableMeta(c: DataverseConfig, t: TableInfo, deps: DvDeps = {}): Promise<TableMeta> {
  const [summary] = await describeTables(c, [t], deps);
  if (summary.error) throw new Error(`Couldn’t read ${t.displayName}: ${summary.error}`);
  return {
    logicalName: t.logicalName,
    displayName: t.displayName,
    entitySet: t.entitySet,
    primaryId: summary.primaryId,
    primaryName: summary.primaryName,
    columns: summary.columns.filter((col) => col.type !== 'Virtual' && col.type !== 'Uniqueidentifier'),
    image: await imageColumn(c, t.logicalName, deps),
    links: await manyToMany(c, t.logicalName, deps),
  };
}

// ---------- guessing the mapping ----------

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const bare = (logical: string) => squash(logical.includes('_') ? logical.slice(logical.indexOf('_') + 1) : logical);

/** Microsoft's own solutions (Dynamics, Power Pages…) also count as "custom" tables in Dataverse. */
export function isMicrosoftTable(logical: string): boolean {
  const prefix = logical.includes('_') ? logical.slice(0, logical.indexOf('_')) : '';
  return /^(ms[a-z0-9]*|adx|powerpage[a-z]*)$/i.test(prefix);
}

const prefixOf = (logical: string) => (logical.includes('_') ? logical.slice(0, logical.indexOf('_')) : '');

/**
 * Picks the most likely cats and events tables (by display or logical name). Tables from the same
 * publisher as the cats table, and anyone's own tables over Microsoft's, come first.
 */
export function guessTables(tables: TableInfo[]): { catTable: string; eventTable: string } {
  const own = tables.filter((t) => !isMicrosoftTable(t.logicalName));
  const score = (t: TableInfo, words: RegExp[], avoid?: RegExp) => {
    const names = [squash(t.displayName), bare(t.logicalName)];
    if (avoid && names.some((n) => avoid.test(n))) return 0;
    for (let i = 0; i < words.length; i++) if (names.some((n) => words[i].test(n))) return words.length - i;
    return 0;
  };
  const best = (pool: TableInfo[], words: RegExp[], avoid?: RegExp, not?: string, prefix?: string) =>
    pool
      .filter((t) => t.logicalName !== not)
      .map((t) => ({ t, s: score(t, words, avoid), same: prefix && prefixOf(t.logicalName) === prefix ? 1 : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.same - a.same || b.s - a.s || a.t.displayName.length - b.t.displayName.length)[0]?.t.logicalName ?? '';
  const CAT = [/^(kitty|kitties|kitten|kittens|cat|cats)$/, /kitty|kitties|kitten/, /cat|feline/, /pet|animal/];
  const EVENT = [/kittyevent|catevent/, /event/, /incident|accident|mess/, /log|record|entry/, /poo|barf|vomit/];
  const catTable = best(own, CAT, /event|log|record|incident/) || best(tables, CAT, /event|log|record|incident/);
  const prefix = prefixOf(catTable);
  let eventTable = best(own, EVENT, undefined, catTable, prefix);
  if (!eventTable && prefix) {
    // No event-like name: if the cats table's publisher has just one other table, that's it.
    const siblings = own.filter((t) => t.logicalName !== catTable && prefixOf(t.logicalName) === prefix);
    if (siblings.length === 1) eventTable = siblings[0].logicalName;
  }
  eventTable ||= best(tables, EVENT, undefined, catTable, prefix);
  return { catTable, eventTable };
}

const TEXT = ['String', 'Memo'];
const NUMBER = ['Integer', 'Decimal', 'Double', 'BigInt'];
const CHOICE = ['Picklist', 'State', 'Status', 'MultiSelectPicklist'];
const LOOKUP = ['Lookup', 'Customer', 'Owner'];

interface Rule {
  words: RegExp;
  types: string[];
  avoid?: RegExp;
}

const RULES: Record<'catNotes' | 'birthday' | 'catNames' | 'type' | 'occurredAt' | 'number' | 'notes', Rule> = {
  catNotes: { words: /note|description|comment|detail|about|bio/, types: TEXT },
  birthday: { words: /birth|born|dob|age/, types: ['DateTime'] },
  catNames: { words: /kitty|kitties|cat|who|culprit|pet/, types: TEXT, avoid: /note|comment|description|type|event/ },
  type: { words: /type|kind|what|event|category|action|activity/, types: [...CHOICE, ...TEXT, ...LOOKUP], avoid: /note|comment|description|date|time|number|name|kitty|cat/ },
  occurredAt: { words: /when|date|time|occurred|happened|eventdate|day/, types: ['DateTime'], avoid: /createdon|modifiedon|birth/ },
  number: { words: /number|num|no$|id$|autonumber|seq|count|#/, types: [...NUMBER, ...TEXT], avoid: /name|note|phone/ },
  notes: { words: /note|comment|description|detail|remark/, types: TEXT },
};

function pick(cols: ColumnSummary[], rule: Rule, used: Set<string>): string {
  const hit = cols.find((col) => {
    if (used.has(col.name) || !rule.types.includes(col.type)) return false;
    const n = squash(col.label) + ' ' + bare(col.name);
    return rule.words.test(n) && !(rule.avoid && rule.avoid.test(n));
  });
  if (hit) used.add(hit.name);
  return hit?.name ?? '';
}

/** Matches columns to CatLog fields by name and type. */
export function guessColumns(cat: TableMeta | null, event: TableMeta | null): Pick<Mapping, 'cat' | 'event' | 'catLink'> {
  const catMap: Mapping['cat'] = {};
  if (cat) {
    const used = new Set<string>([cat.primaryName]);
    catMap.name = cat.primaryName;
    catMap.birthday = pick(cat.columns, RULES.birthday, used);
    catMap.notes = pick(cat.columns, RULES.catNotes, used);
  }
  const ev: Mapping['event'] = {};
  let catLink = '';
  if (event) {
    const used = new Set<string>([event.primaryName]);
    if (cat) {
      const lookups = event.columns.filter((col) => LOOKUP.includes(col.type) && col.targets?.includes(cat.logicalName));
      (['cat1', 'cat2', 'cat3'] as const).forEach((f, i) => {
        ev[f] = lookups[i]?.name ?? '';
        if (ev[f]) used.add(ev[f]!);
      });
      catLink = event.links.find((l) => l.with === cat.logicalName)?.nav ?? '';
    }
    ev.catNames = ev.cat1 || catLink ? '' : pick(event.columns, RULES.catNames, used);
    ev.occurredAt = pick(event.columns, RULES.occurredAt, used) || (event.columns.some((c) => c.name === 'createdon') ? 'createdon' : '');
    ev.type = pick(event.columns, RULES.type, used);
    ev.number = pick(event.columns, RULES.number, used);
    ev.notes = pick(event.columns, RULES.notes, used);
  }
  return { cat: catMap, event: ev, catLink };
}

/** Keeps only columns and links that still exist (a saved mapping may refer to deleted ones). */
export function cleanMapping(m: Mapping, cat: TableMeta | null, event: TableMeta | null): Mapping {
  const keep = <K extends string>(cols: Partial<Record<K, string>>, meta: TableMeta | null) =>
    Object.fromEntries(Object.entries(cols).filter(([, v]) => !v || meta?.columns.some((c) => c.name === v))) as Partial<Record<K, string>>;
  return {
    ...m,
    cat: keep(m.cat, cat),
    event: keep(m.event, event),
    catLink: m.catLink && event?.links.some((l) => l.nav === m.catLink) ? m.catLink : '',
  };
}

// ---------- reading rows ----------

export function propFor(meta: TableMeta, column: string): string {
  const col = meta.columns.find((c) => c.name === column);
  return col && LOOKUP.includes(col.type) ? `_${column}_value` : column;
}

export interface Source {
  cats: Json[];
  events: Json[];
}

async function readTable(c: DataverseConfig, meta: TableMeta, columns: string[], deps: DvDeps, expand?: string): Promise<Json[]> {
  const props = new Set([meta.primaryId, meta.primaryName, ...columns.filter(Boolean).map((col) => propFor(meta, col))]);
  if (meta.image) props.add(`${meta.image.column}id`);
  if (meta.columns.some((col) => col.name === 'createdon')) props.add('createdon');
  const hasState = meta.columns.some((col) => col.name === 'statecode');
  const parts = [`$select=${[...props].filter(Boolean).join(',')}`];
  if (hasState) parts.push('$filter=statecode eq 0');
  if (expand) parts.push(`$expand=${expand}`);
  return dvGetAll(c, `${meta.entitySet}?${parts.join('&')}`, deps);
}

export async function fetchSource(
  c: DataverseConfig,
  m: Mapping,
  metas: { cat: TableMeta | null; event: TableMeta | null },
  deps: DvDeps = {},
  onProgress?: (msg: string) => void,
): Promise<Source> {
  const say = onProgress ?? (() => {});
  let cats: Json[] = [];
  let events: Json[] = [];
  if (metas.cat) {
    say('Reading cats…');
    cats = await readTable(c, metas.cat, Object.values(m.cat) as string[], deps);
  }
  if (metas.event) {
    say('Reading events…');
    const expand = m.catLink && metas.cat ? `${m.catLink}($select=${metas.cat.primaryId},${metas.cat.primaryName})` : undefined;
    events = await readTable(c, metas.event, Object.values(m.event) as string[], deps, expand);
  }
  return { cats, events };
}

// ---------- converting values ----------

export async function stableId(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dataverse date/time → local "YYYY-MM-DDTHH:mm" (UTC values are shown in this device's time zone). */
export function toLocalDateTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T12:00`;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null;
}

export function textOf(row: Json, prop: string): string {
  const f = row[prop + FORMATTED];
  const v = typeof f === 'string' && f ? f : row[prop];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** A number column, or the digits in an autonumber like "EV-3512". */
export function numberOf(row: Json, prop: string): number | null {
  const v = row[prop];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const m = /(\d{1,9})(?!.*\d)/.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
}

const SOMEBODY = /^(somebody|someone|some ?one|unknown|unknown cat|\?+|who\??|not sure|idk)$/i;
const strip = (s: string) => s.trim().toLowerCase().replace(/^the\s+/, '');

/** Splits "Stormy & The Bandit", "Stormy, Luna and Max" into names. */
export function splitCatNames(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|\+|\/|;|\s+and\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const TYPE_WORD = /\s+(pooed|pooped|poo|poop|barfed|barf|puked|vomited|threw up|peed|pee|hairball|[a-z]+ed)\s*[.!]*$/i;

/** "Stormy & The Bandit Pooed" → { names: ['Stormy', 'The Bandit'], type: 'Pooed' }. */
export function parseTitle(title: string): { names: string[]; type: string } {
  const t = title.trim();
  const m = TYPE_WORD.exec(t);
  if (!m) return { names: t ? splitCatNames(t) : [], type: '' };
  return { names: splitCatNames(t.slice(0, m.index)), type: normalizeType(m[1]) };
}

// ---------- planning ----------

export interface PhotoJob {
  table: 'cats' | 'events';
  id: string;
  record: string;
  image: ImageColumn;
}

export interface Plan {
  cats: Cat[];
  events: CatEvent[];
  photos: PhotoJob[];
  fields: { cat: CatField[]; event: EventField[] };
  warnings: string[];
}

export async function buildPlan(
  src: Source,
  m: Mapping,
  metas: { cat: TableMeta | null; event: TableMeta | null },
  somebody: string,
): Promise<Plan> {
  const now = Date.now();
  const warnings: string[] = [];
  const photos: PhotoJob[] = [];
  const cats: Cat[] = [];
  const byDvId = new Map<string, string>();
  const byName = new Map<string, string>();
  const cm = metas.cat;
  const em = metas.event;
  let sort = 0;

  const addNamedCat = async (name: string): Promise<string> => {
    if (SOMEBODY.test(name.trim())) return somebody;
    const key = strip(name);
    let id = byName.get(key);
    if (!id) {
      id = await stableId(`dv-cat-name|${key}`);
      byName.set(key, id);
      cats.push({ id, name: name.trim(), isSomebody: false, notes: '', birthday: '', color: '', sortOrder: sort++, archived: false, createdAt: now, updatedAt: now });
    }
    return id;
  };

  if (cm) {
    const col = (f: CatField) => (m.cat[f] ? propFor(cm, m.cat[f]!) : '');
    for (const row of src.cats) {
      const dvId = String(row[cm.primaryId]);
      const name = col('name') ? textOf(row, col('name')) : '';
      if (!name) {
        warnings.push(`Skipped a cat with no name (${dvId}).`);
        continue;
      }
      const isSomebody = SOMEBODY.test(name);
      const id = isSomebody ? somebody : await stableId(`dv-cat|${dvId}`);
      byDvId.set(dvId, id);
      if (!isSomebody) byName.set(strip(name), id);
      const born = col('birthday') ? toLocalDateTime(row[col('birthday')]) : null;
      cats.push({
        id,
        name: isSomebody ? 'Somebody' : name,
        isSomebody,
        notes: col('notes') ? textOf(row, col('notes')) : '',
        birthday: born ? born.slice(0, 10) : '',
        color: '',
        sortOrder: isSomebody ? 1000 : sort++,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      if (cm.image && row[`${cm.image.column}id`]) photos.push({ table: 'cats', id, record: `${cm.entitySet}(${dvId})`, image: cm.image });
    }
  }

  const events: CatEvent[] = [];
  let toSomebody = 0;
  let noDate = 0;
  let untyped = 0;
  if (em) {
    const col = (f: EventField) => (m.event[f] ? propFor(em, m.event[f]!) : '');
    const catPk = cm?.primaryId ?? '';
    for (const row of src.events) {
      const dvId = String(row[em.primaryId]);
      const ids: string[] = [];
      const push = (id: string | undefined) => {
        if (id && !ids.includes(id)) ids.push(id);
      };
      for (const f of ['cat1', 'cat2', 'cat3'] as const) {
        if (!col(f)) continue;
        const v = row[col(f)];
        if (typeof v === 'string' && v) {
          const known = byDvId.get(v);
          if (known) push(known);
          else {
            const label = textOf(row, col(f));
            if (label) push(await addNamedCat(label));
          }
        }
      }
      if (m.catLink && Array.isArray(row[m.catLink])) {
        for (const linked of row[m.catLink] as Json[]) {
          const known = byDvId.get(String(linked[catPk]));
          if (known) push(known);
          else if (cm && typeof linked[cm.primaryName] === 'string') push(await addNamedCat(String(linked[cm.primaryName])));
        }
      }
      const title = em.primaryName ? textOf(row, em.primaryName) : '';
      const parsed = parseTitle(title);
      if (!ids.length && col('catNames')) for (const n of splitCatNames(textOf(row, col('catNames')))) push(await addNamedCat(n));
      if (!ids.length) for (const n of parsed.names) push(await addNamedCat(n));
      // Real cats win over Somebody when both are listed.
      const real = ids.filter((id) => id !== somebody);
      const catIds = real.length ? real : [somebody];
      if (!real.length) toSomebody++;

      let type = col('type') ? textOf(row, col('type')) : '';
      type = type ? normalizeType(type) : parsed.type;
      if (!type) {
        untyped++;
        type = 'Pooed';
      }
      let occurredAt = col('occurredAt') ? toLocalDateTime(row[col('occurredAt')]) : null;
      if (!occurredAt) {
        noDate++;
        occurredAt = toLocalDateTime(row.createdon) ?? toLocalDateTime(new Date().toISOString())!;
      }
      const id = await stableId(`dv-event|${dvId}`);
      events.push({
        id,
        number: col('number') ? numberOf(row, col('number')) : null,
        type,
        catIds,
        occurredAt,
        notes: col('notes') ? textOf(row, col('notes')) : '',
        source: 'import',
        createdAt: now,
        updatedAt: now,
      });
      if (em.image && row[`${em.image.column}id`]) photos.push({ table: 'events', id, record: `${em.entitySet}(${dvId})`, image: em.image });
    }
  }
  if (toSomebody) warnings.push(`${toSomebody} event${toSomebody === 1 ? '' : 's'} didn’t say which cat, so they go to Somebody. You can change them later.`);
  if (noDate) warnings.push(`${noDate} event${noDate === 1 ? '' : 's'} had no date, so the date the record was created is used.`);
  if (untyped) warnings.push(`${untyped} event${untyped === 1 ? '' : 's'} didn’t say what happened, so they’re logged as Pooed.`);

  return {
    cats,
    events,
    photos,
    fields: {
      cat: CAT_FIELDS.filter((f) => cm && m.cat[f]),
      event: EVENT_FIELDS.filter((f) => em && m.event[f]),
    },
    warnings,
  };
}

// ---------- applying ----------

export interface ApplyResult {
  cats: number;
  events: number;
  merged: number;
  numbered: number;
  photos: number;
  photoFailures: number;
  firstPhotoError?: string;
}

export async function downloadImage(c: DataverseConfig, job: PhotoJob, deps?: DvDeps): Promise<Blob | null> {
  const { record, image } = job;
  let lastError: unknown = null;
  const attempts = [...(image.full ? [`${record}/${image.column}/$value?size=full`] : []), `${record}/${image.column}/$value`];
  for (const path of attempts) {
    try {
      const blob = await dvGetBlob(c, path, deps);
      if (blob) return blob;
    } catch (e) {
      lastError = e;
    }
  }
  try {
    const row = await dvGet<Json>(c, `${record}?$select=${image.column}`, deps);
    const b64 = row[image.column];
    if (typeof b64 === 'string' && b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/jpeg' });
    }
  } catch (e) {
    lastError = e;
  }
  if (lastError) throw lastError;
  return null;
}

const prefer = (imported: string, old: string | undefined) => imported || old || '';

/**
 * Writes the plan into CatLog (and, through sync, to the account). Re-importing updates the same
 * records. A cat you already added with the same name is updated rather than duplicated.
 * Events without a number get the next numbers, oldest first.
 */
export async function applyPlan(
  c: DataverseConfig,
  plan: Plan,
  opts: { includePhotos: boolean; deps?: DvDeps; onProgress?: (msg: string) => void; resize?: (b: Blob) => Promise<string> },
): Promise<ApplyResult> {
  const say = opts.onProgress ?? (() => {});
  const resize = opts.resize ?? ((b: Blob) => resizeImage(b, 800));
  const photoFor = new Map<string, string>();
  let photos = 0;
  let photoFailures = 0;
  let firstPhotoError: string | undefined;

  if (opts.includePhotos && plan.photos.length) {
    let done = 0;
    const queue = [...plan.photos];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const blob = await downloadImage(c, job, opts.deps);
          if (blob) {
            photoFor.set(job.id, await resize(blob));
            photos++;
          }
        } catch (e) {
          photoFailures++;
          firstPhotoError ??= (e as Error).message;
        }
        say(`Downloading photos… ${++done} of ${plan.photos.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  say('Saving…');
  let merged = 0;
  let numbered = 0;
  await db.transaction('rw', [db.cats, db.events], async () => {
    const existing = await db.cats.toArray();
    const byId = new Map(existing.map((x) => [x.id, x]));
    const byName = new Map(existing.filter((x) => !x.isSomebody).map((x) => [strip(x.name), x]));
    const maxSort = existing.filter((x) => !x.isSomebody).reduce((n, x) => Math.max(n, x.sortOrder), -1);
    const remap = new Map<string, string>();
    const cats: Cat[] = plan.cats.map((k) => {
      let old = byId.get(k.id);
      if (!old && !k.isSomebody) {
        old = byName.get(strip(k.name));
        if (old) {
          remap.set(k.id, old.id);
          merged++;
        }
      }
      const photo = photoFor.get(k.id) ?? old?.photo;
      const out: Cat = {
        id: old?.id ?? k.id,
        name: old?.isSomebody ? old.name : k.name,
        isSomebody: k.isSomebody,
        notes: prefer(k.notes, old?.notes),
        birthday: prefer(k.birthday, old?.birthday),
        color: old?.color ?? '',
        sortOrder: old?.sortOrder ?? (k.isSomebody ? 1000 : maxSort + 1 + k.sortOrder),
        archived: old?.archived ?? false,
        createdAt: old?.createdAt ?? k.createdAt,
        updatedAt: k.updatedAt,
      };
      if (photo) out.photo = photo;
      return out;
    });
    await db.cats.bulkPut(cats);

    const oldEvents = await db.events.bulkGet(plan.events.map((e) => e.id));
    const events: CatEvent[] = plan.events.map((e, i) => {
      const old = oldEvents[i];
      const photo = photoFor.get(e.id) ?? old?.photo;
      const out: CatEvent = {
        ...e,
        catIds: [...new Set(e.catIds.map((id) => remap.get(id) ?? id))],
        number: e.number ?? old?.number ?? null,
        notes: prefer(e.notes, old?.notes),
        createdAt: old?.createdAt ?? e.createdAt,
      };
      if (photo) out.photo = photo;
      return out;
    });
    // Number the ones that have none, after the highest number in use.
    const others = await db.events.toArray();
    const importing = new Set(events.map((e) => e.id));
    let max = Math.max(0, ...others.filter((e) => !importing.has(e.id)).map((e) => e.number ?? 0), ...events.map((e) => e.number ?? 0));
    for (const e of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
      if (e.number === null) {
        e.number = ++max;
        numbered++;
      }
    }
    await db.events.bulkPut(events);
  });

  return { cats: plan.cats.length, events: plan.events.length, merged, numbered, photos, photoFailures, firstPhotoError };
}
