import { createClient } from '@supabase/supabase-js';

// Public project URL and publishable key. These are meant to ship in the browser:
// what each signed-in user can read or write is enforced by row level security.
// This is the same Supabase project as Packlist and Pickup, so the same account signs in to all three.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hpyjxwmfxjopbvojagqe.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_KdcUeJFeSRmSzNPe7pijWQ_bt3z9eGP';

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

/** Where confirmation and password-reset emails should send people back to. */
export function appUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}
