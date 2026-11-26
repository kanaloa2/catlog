const pad = (n: number) => String(n).padStart(2, '0');

/** Now as local "YYYY-MM-DDTHH:mm". */
export function nowLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayYmd(d = new Date()): string {
  return nowLocal(d).slice(0, 10);
}

export const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function parseLocal(dt: string): Date {
  const [d, t = '00:00'] = dt.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, day, hh, mm);
}

/** "Tue, Nov 26 · 6:30 PM" (year added when it isn't this year). */
export function formatWhen(dt: string): string {
  if (!LOCAL_DT.test(dt)) return dt;
  const d = parseLocal(dt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** "Nov 26" or "Nov 26, 2025". */
export function formatDay(dt: string): string {
  if (!LOCAL_DT.test(dt)) return dt;
  const d = parseLocal(dt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "November 2026", used to group orders. */
export function monthLabel(dt: string): string {
  if (!LOCAL_DT.test(dt)) return 'Undated';
  return parseLocal(dt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** "3 days ago", "today", "in 2 weeks"… relative to now. */
export function ago(dt: string, now = new Date()): string {
  if (!LOCAL_DT.test(dt)) return '';
  const then = parseLocal(dt);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(then)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 0) return 'upcoming';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

/**
 * A tel: link for a phone number as typed, or null if it has no digits. An extension or menu
 * option with digits ("Opt 1", "x204") is dialed after a pause.
 */
export function telHref(phone: string, ext = ''): string | null {
  const trimmed = phone.trim();
  // Keep a leading +, digits, and pause/extension marks; drop spaces, dashes, brackets, dots.
  const cleaned = trimmed.replace(/(?!^\+)[^\d,;]/g, '').replace(/^\+?$/, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 3) return null;
  const extDigits = ext.replace(/\D/g, '');
  return `tel:${cleaned}${extDigits && !/[,;]/.test(cleaned) ? `,${extDigits}` : ''}`;
}

/**
 * Normalizes a link typed by the user: adds https:// when there's no scheme, and returns
 * '' for empty input. Throws for anything that isn't a plain web link.
 */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error('That doesn’t look like a web address.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Links must start with http:// or https://');
  if (!u.hostname.includes('.')) throw new Error('That doesn’t look like a web address.');
  return u.toString();
}

/** Same as normalizeUrl but returns '' instead of throwing (for imported data). */
export function safeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return normalizeUrl(raw);
  } catch {
    return '';
  }
}

/** Short display form of a link: host + path without the scheme or trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

/** A maps search link for an address (opens the maps app on phones). */
export function mapsHref(address: string): string | null {
  const a = address.trim();
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

/** "4.5" for 4.5, "4" for 4.0 */
export function formatRating(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

/** "11:22 AM" */
export function formatTime(dt: string): string {
  if (!LOCAL_DT.test(dt)) return dt;
  return parseLocal(dt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "11/25/2026 11:22 AM", like the old app. */
export function formatStamp(dt: string): string {
  if (!LOCAL_DT.test(dt)) return dt;
  const d = parseLocal(dt);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Wed Nov 25 2026" */
export function formatLongDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export { parseLocal };
