import { supabase, SUPABASE_KEY, SUPABASE_URL } from '../supabase';

/** A shortcut key: lets iOS Shortcuts, widgets and email add events without signing in. Stored hashed. */
export interface ShortcutKey {
  id: string;
  label: string;
  time_zone: string;
  created_at: string;
  last_used_at: string | null;
}

const LOCAL = 'catlog.shortcutKey';

export async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function listKeys(): Promise<ShortcutKey[]> {
  const { data, error } = await supabase.from('catlog_shortcut_keys').select('id,label,time_zone,created_at,last_used_at').order('created_at');
  if (error) throw error;
  return data as ShortcutKey[];
}

/** Makes a key, saves its hash to the account and keeps the key itself on this device. */
export async function createKey(label: string): Promise<string> {
  const key = randomKey();
  const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { error } = await supabase.from('catlog_shortcut_keys').insert({ key_hash: await sha256Hex(key), label: label.trim().slice(0, 60) || 'Shortcuts', time_zone });
  if (error) throw error;
  rememberKey(key);
  return key;
}

export async function deleteKey(id: string): Promise<void> {
  const { error } = await supabase.from('catlog_shortcut_keys').delete().eq('id', id);
  if (error) throw error;
}

export function rememberKey(key: string) {
  try {
    localStorage.setItem(LOCAL, key);
  } catch {
    /* storage unavailable */
  }
}

export function savedKey(): string {
  try {
    return localStorage.getItem(LOCAL) ?? '';
  } catch {
    return '';
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(LOCAL);
  } catch {
    /* storage unavailable */
  }
}

/** Whether this site also runs CatLog's worker (so /api/add exists). */
export async function hasWorkerApi(): Promise<boolean> {
  try {
    const res = await fetch(`${location.origin}/api/ping`, { cache: 'no-store' });
    const body = (await res.json()) as { app?: string };
    return body.app === 'catlog';
  } catch {
    return false;
  }
}

export function addUrl(apiBase: string, key: string, cat: string, type: string): string {
  const q = new URLSearchParams({ k: key, cat, type });
  return `${apiBase}/api/add?${q}`;
}

export const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/catlog_quick_add`;
export const LOG_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/catlog_log_text`;
export const PUBLIC_KEY = SUPABASE_KEY;

/** Logs every "<cat> pooed/barfed" line in the text, through the same function email uses. */
export async function logText(key: string, text: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.rpc('catlog_log_text', { p_key: key, p_text: text, p_source: 'app' });
  if (error) return { ok: false, message: error.message };
  return data as { ok: boolean; message: string };
}
