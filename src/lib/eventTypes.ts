import type { Cat, CatEvent } from '../types';

export interface TypeInfo {
  name: string;
  emoji: string;
  color: string;
}

/** The built-in event types, in the order they're offered. Anything else can be typed. */
export const EVENT_TYPES: TypeInfo[] = [
  { name: 'Pooed', emoji: '💩', color: '#c2410c' },
  { name: 'Barfed', emoji: '🤮', color: '#16a34a' },
  { name: 'Peed', emoji: '💦', color: '#0284c7' },
  { name: 'Hairball', emoji: '🧶', color: '#9333ea' },
];

const OTHER: Omit<TypeInfo, 'name'> = { emoji: '🐾', color: '#64748b' };

export function typeInfo(name: string): TypeInfo {
  return EVENT_TYPES.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? { name, ...OTHER };
}

/** "poop", "pooped", "💩" → Pooed; "barf", "puke", "vomit" → Barfed… Unknown words are title-cased. */
export function normalizeType(raw: string): string {
  const w = raw.trim().toLowerCase();
  if (!w) return 'Pooed';
  if (/^(poo|poop|pooed|pooped|poops|poos|💩)$/.test(w)) return 'Pooed';
  if (/^(barf|barfed|barfs|puke|puked|vomit|vomited|threw ?up|throw ?up|🤮)$/.test(w)) return 'Barfed';
  if (/^(pee|peed|pees|wee|weed|💦)$/.test(w)) return 'Peed';
  if (/^(hairball|hairballs|hair ?ball|🧶)$/.test(w)) return 'Hairball';
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** "Stormy", "Stormy & The Bandit", "Stormy, Luna & Max". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'Somebody';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function catsOf(e: CatEvent, catsById: Map<string, Cat>): Cat[] {
  return e.catIds.map((id) => catsById.get(id)).filter((c): c is Cat => !!c);
}

/** "Stormy & The Bandit Pooed" */
export function eventTitle(e: CatEvent, catsById: Map<string, Cat>): string {
  const names = catsOf(e, catsById).map((c) => c.name);
  return `${joinNames(names.length ? names : ['Somebody'])} ${e.type}`;
}

/** True when the culprit isn't known yet (no cats, or only Somebody). */
export function isUnknown(e: CatEvent, catsById: Map<string, Cat>): boolean {
  const cats = catsOf(e, catsById);
  return cats.length === 0 || cats.every((c) => c.isSomebody);
}

/** Every type in use plus the built-ins, built-ins first. */
export function allTypes(events: CatEvent[] | undefined): string[] {
  const seen = new Set(EVENT_TYPES.map((t) => t.name));
  const extra: string[] = [];
  for (const e of events ?? []) if (!seen.has(e.type)) seen.add(e.type), extra.push(e.type);
  return [...EVENT_TYPES.map((t) => t.name), ...extra.sort()];
}

/** Automatic accent colors for cats without one. */
const PALETTE = ['#2563eb', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#dc2626', '#4d7c0f', '#0891b2'];
export function catColor(cat: Pick<Cat, 'color' | 'id' | 'isSomebody'>): string {
  if (cat.color) return cat.color;
  if (cat.isSomebody) return '#64748b';
  let h = 0;
  for (const ch of cat.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
