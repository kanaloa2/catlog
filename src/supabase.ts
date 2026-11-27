import { createClient } from '@supabase/supabase-js';

// Public project URL and publishable key. These are meant to ship in the browser:
// what each signed-in user can read or write is enforced by row level security.
// This is the same Supabase project as Packlist and Pickup, so the same account signs in to all three.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hpyjxwmfxjopbvojagqe.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_KdcUeJFeSRmSzNPe7pijWQ_bt3z9eGP';

/**
 * Password reset across hosts. The shared Supabase project only sends email links back to hosts it
 * knows: Packlist's site (kanaloa2.github.io) and any URLs added in its settings. A reset asked for
 * on another host, like catlog.cjbrowning7.workers.dev, would land on Packlist. So resets are sent
 * to CatLog's copy on kanaloa2.github.io with the tokens in the link itself (not a PKCE code, which
 * only works in the browser storage that asked), and that page sets the new password.
 */
export const RESET_HOME = 'https://kanaloa2.github.io/catlog/';
/** CatLog addresses a reset may send people back to afterwards. */
export const CATLOG_HOMES = ['https://catlog.cjbrowning7.workers.dev/', RESET_HOME];

export interface PendingRecovery {
  tokens?: { access_token: string; refresh_token: string };
  error?: string;
  backTo?: string;
}

/** Reads (and removes) a password-reset link's tokens from the address before anything else sees it. */
function takeRecoveryFromUrl(): PendingRecovery | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
  const search = new URLSearchParams(window.location.search);
  const isRecovery = hash.get('type') === 'recovery' && hash.get('access_token') && hash.get('refresh_token');
  const isError = hash.has('error_code') || hash.has('error_description');
  if (!isRecovery && !isError) return null;
  const from = search.get('from') ?? '';
  const backTo = CATLOG_HOMES.includes(from) && from !== window.location.origin + import.meta.env.BASE_URL ? from : undefined;
  window.history.replaceState(null, '', window.location.pathname + '#/');
  if (isRecovery) return { tokens: { access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! }, backTo };
  const expired = hash.get('error_code') === 'otp_expired' || /expired|invalid/i.test(hash.get('error_description') ?? '');
  return { error: expired ? 'That reset link has expired or was already used. Send a new one below.' : (hash.get('error_description') ?? 'That link didn’t work.'), backTo };
}

export const pendingRecovery = takeRecoveryFromUrl();

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE returns ?code=… in the query string, which doesn't collide with our #/hash routes.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Packlist and Pickup may live on the same origin (kanaloa2.github.io). A separate key keeps each
    // app's sign-in, and signing out of one, independent.
    storageKey: 'catlog-auth',
  },
});

/** Where confirmation emails should send people back to. */
export function appUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

// Only used to send reset emails. The implicit flow puts the tokens in the link, so the link works
// on CatLog's kanaloa2.github.io page whichever browser opens it.
const resetClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'catlog-reset' },
});

export function sendPasswordReset(email: string) {
  const here = appUrl();
  const redirectTo = here === RESET_HOME ? RESET_HOME : `${RESET_HOME}?from=${encodeURIComponent(here)}`;
  return resetClient.auth.resetPasswordForEmail(email, { redirectTo });
}
