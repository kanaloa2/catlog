/** A cat. One built-in cat, "Somebody", stands in for events whose culprit isn't known yet. */
export interface Cat {
  id: string;
  name: string;
  /** True for the built-in Somebody cat (its id is the account's user id). */
  isSomebody: boolean;
  notes: string;
  /** YYYY-MM-DD or '' */
  birthday: string;
  /** Accent color like #f97316, or '' for automatic. */
  color: string;
  /** Lower comes first in the cat row. */
  sortOrder: number;
  /** Hidden from pickers and the cat row, but kept on old events. */
  archived: boolean;
  /** Resized JPEG as a data URL locally; a storage path on the server. */
  photo?: string;
  createdAt: number;
  updatedAt: number;
}

/** Something a cat did: pooed, barfed… */
export interface CatEvent {
  id: string;
  /** Running number like 3512, or null. */
  number: number | null;
  /** Pooed, Barfed, Peed, Hairball or anything typed. */
  type: string;
  /** Who did it (the Somebody cat when unknown). */
  catIds: string[];
  /** YYYY-MM-DDTHH:mm (local time) */
  occurredAt: string;
  notes: string;
  /** app, quick, shortcut, email, import */
  source: string;
  photo?: string;
  createdAt: number;
  updatedAt: number;
}
