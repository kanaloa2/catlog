import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { checkConfig, type DataverseConfig } from './config';
import type { Mapping } from './catImporter';

/**
 * Dataverse settings saved to the user's account (Supabase Auth user metadata), so they're
 * entered once and every signed-in device picks them up. A copy is kept on the device so
 * the panel works offline. The newest copy wins.
 *
 * CatLog saves under its own key ("catlog_dataverse") so it never changes Packlist's settings,
 * but until it has its own it starts from Packlist's connection ("dataverse"), which is the
 * same account. That way the environment and Entra IDs don't need typing in again.
 */
export interface SyncedDataverseSettings extends DataverseConfig {
  /** Which tables and columns to import from. */
  mapping?: Mapping;
  /** When these settings were last saved (ms). */
  updatedAt?: number;
}

type Auth = Pick<SupabaseClient['auth'], 'getUser' | 'getSession' | 'updateUser'>;

export const META_KEY = 'catlog_dataverse';
export const PACKLIST_KEY = 'dataverse';

function parse(d: unknown): SyncedDataverseSettings | null {
  const s = d as Partial<SyncedDataverseSettings> | undefined;
  if (!s || typeof s.clientId !== 'string' || typeof s.tenantId !== 'string' || typeof s.envUrl !== 'string') return null;
  return {
    envUrl: s.envUrl,
    clientId: s.clientId,
    tenantId: s.tenantId,
    mapping: s.mapping && typeof s.mapping === 'object' ? (s.mapping as Mapping) : undefined,
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
  };
}

export function fromUser(user: User | null | undefined): SyncedDataverseSettings | null {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const own = parse(meta?.[META_KEY]);
  if (own) return own;
  // Borrow Packlist's connection (not its table filter); treat it as older than anything local.
  const packlist = parse(meta?.[PACKLIST_KEY]);
  return packlist ? { envUrl: packlist.envUrl, clientId: packlist.clientId, tenantId: packlist.tenantId, updatedAt: 0 } : null;
}

/** The account's copy: fresh from the server when online, else from the cached session. */
export async function fetchAccountSettings(auth: Auth = supabase.auth): Promise<SyncedDataverseSettings | null> {
  const { data, error } = await auth.getUser();
  if (!error && data.user) return fromUser(data.user);
  const { data: s } = await auth.getSession();
  return fromUser(s.session?.user);
}

export async function saveAccountSettings(settings: SyncedDataverseSettings, auth: Auth = supabase.auth): Promise<void> {
  const { error } = await auth.updateUser({ data: { [META_KEY]: settings } });
  if (error) throw error;
}

/**
 * Decides which settings to use on this device. The account copy wins if it's at least as
 * new as this device's; otherwise this device's valid settings are uploaded.
 */
export async function reconcileSettings(
  local: SyncedDataverseSettings | null,
  auth: Auth = supabase.auth,
): Promise<{ settings: SyncedDataverseSettings | null; uploaded: boolean; offline: boolean }> {
  let remote: SyncedDataverseSettings | null = null;
  let offline = false;
  try {
    remote = await fetchAccountSettings(auth);
  } catch {
    offline = true;
  }
  const localOk = !!local && checkConfig(local) === null && (local.updatedAt ?? 0) > 0;
  if (remote && (!localOk || (remote.updatedAt ?? 0) >= (local!.updatedAt ?? 0))) {
    return { settings: remote, uploaded: false, offline };
  }
  if (localOk) {
    try {
      await saveAccountSettings(local!, auth);
      return { settings: local, uploaded: true, offline };
    } catch {
      return { settings: local, uploaded: false, offline: true };
    }
  }
  return { settings: remote ?? local, uploaded: false, offline };
}
