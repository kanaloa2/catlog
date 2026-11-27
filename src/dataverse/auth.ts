import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { normalizeEnvUrl, redirectUri, type DataverseConfig } from './config';

// MSAL is only loaded when someone actually uses the Dataverse import.
let app: { key: string; pca: IPublicClientApplication } | null = null;

const scopesFor = (c: DataverseConfig) => [`${normalizeEnvUrl(c.envUrl)}/user_impersonation`];

async function client(c: DataverseConfig): Promise<IPublicClientApplication> {
  const key = `${c.clientId}|${c.tenantId}`;
  if (app?.key === key) return app.pca;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  const pca = new PublicClientApplication({
    auth: {
      clientId: c.clientId.trim(),
      authority: `https://login.microsoftonline.com/${c.tenantId.trim()}`,
      redirectUri: redirectUri(),
    },
    cache: { cacheLocation: 'localStorage' },
    // MSAL can't see the popup close, so it waits for this long. Leave room for MFA.
    system: { popupBridgeTimeout: 5 * 60_000 },
  });
  await pca.initialize();
  // Coming back from a full-page sign-in (used on phones and tablets): finish it here.
  try {
    const back = await pca.handleRedirectPromise();
    if (back?.account) pca.setActiveAccount(back.account);
  } catch {
    // A failed or cancelled redirect just leaves the person signed out; they can try again.
  }
  app = { key, pca };
  return pca;
}

/**
 * Phones and tablets open "popups" as separate tabs, and the app often can't tell when that tab
 * finishes, so sign-in there goes through a full-page redirect and comes back to Settings.
 */
export function useRedirect(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Forgets a sign-in that was started but never finished (say, a sign-in tab that was closed), so a new one can start. */
function clearStuckSignIn() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (k && k.startsWith('msal.') && k.endsWith('interaction.status')) store.removeItem(k);
      }
    } catch {
      // Storage may be blocked; nothing to clear then.
    }
  }
}

export async function currentAccount(c: DataverseConfig): Promise<AccountInfo | null> {
  const pca = await client(c);
  return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
}

/**
 * Opens Microsoft sign-in and asks for permission to read Dataverse: a popup on computers, a
 * full-page redirect on phones and tablets (the page then reloads signed in, and this never returns).
 */
export async function signIn(c: DataverseConfig): Promise<AccountInfo> {
  const pca = await client(c);
  clearStuckSignIn();
  if (useRedirect()) {
    await pca.loginRedirect({ scopes: scopesFor(c), prompt: 'select_account' });
    return new Promise<AccountInfo>(() => {});
  }
  const res = await pca.loginPopup({ scopes: scopesFor(c), prompt: 'select_account' });
  pca.setActiveAccount(res.account);
  return res.account;
}

/** Plain-English version of an MSAL error. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { errorCode?: string })?.errorCode ?? '';
  const msg = (e as Error)?.message ?? String(e);
  if (code === 'popup_window_error' || /popup.*blocked/i.test(msg)) return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
  if (code === 'user_cancelled' || code === 'timed_out') return 'Sign-in was cancelled or took too long. Try again.';
  if (code === 'interaction_in_progress') return 'An earlier Microsoft sign-in didn’t finish. Tap Sign in with Microsoft again to start over.';
  if (/AADSTS50011/.test(msg)) return `This address isn’t registered on the Entra app yet. Add ${redirectUri()} as a single-page application redirect URI, then try again.`;
  if (/AADSTS65001|consent/i.test(msg)) return 'This app hasn’t been granted access to Dataverse yet. Grant admin consent on the app’s API permissions page.';
  if (/AADSTS700016/.test(msg)) return 'Microsoft doesn’t recognize that Application (client) ID in this tenant. Check both IDs.';
  if (/AADSTS90002/.test(msg)) return 'Microsoft doesn’t recognize that Directory (tenant) ID.';
  return msg;
}

export async function signOut(c: DataverseConfig) {
  const pca = await client(c);
  const account = await currentAccount(c);
  // Forget the account in this app only; don't sign the user out of Microsoft everywhere.
  if (account) await pca.clearCache({ account });
}

// One token request at a time: the importer asks for several tables at once, and parallel
// requests that each fell back to a popup collided ("interaction_in_progress").
let pending: Promise<string> | null = null;

/** An access token for the Dataverse Web API, renewing silently, or by popup or redirect if needed. */
export function getToken(c: DataverseConfig): Promise<string> {
  pending ??= fetchToken(c).finally(() => {
    pending = null;
  });
  return pending;
}

async function fetchToken(c: DataverseConfig): Promise<string> {
  const pca = await client(c);
  const account = await currentAccount(c);
  if (!account) throw new Error('Sign in with Microsoft first.');
  try {
    return (await pca.acquireTokenSilent({ scopes: scopesFor(c), account })).accessToken;
  } catch {
    clearStuckSignIn();
    if (useRedirect()) {
      await pca.acquireTokenRedirect({ scopes: scopesFor(c), account });
      return new Promise<string>(() => {});
    }
    return (await pca.acquireTokenPopup({ scopes: scopesFor(c), account })).accessToken;
  }
}
