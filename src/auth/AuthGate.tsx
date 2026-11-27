import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { pendingRecovery, supabase } from '../supabase';
import { clearLocalData, localOwner, setLocalOwner, sync } from '../sync';
import { AuthScreen, SetPasswordScreen, Splash } from './AuthScreens';

interface AuthContextValue {
  session: Session;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthGate>');
  return ctx;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut'; notice?: string }
  | { kind: 'recovery'; session: Session; backTo?: string }
  | { kind: 'ready'; session: Session };

/**
 * Shows the sign-in screen until there's a session, makes sure this device's local copy
 * belongs to the signed-in user, then starts sync and renders the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhaseState] = useState<Phase>({ kind: 'loading' });
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const preparedFor = useRef<string | null>(null);
  // A reset link's tokens, read from the address by supabase.ts. While set, sign-in events wait.
  const recovering = useRef(!!pendingRecovery?.tokens);
  const hadCode = useRef(new URLSearchParams(window.location.search).has('code'));

  async function prepare(session: Session) {
    const uid = session.user.id;
    if (preparedFor.current === uid) return;
    preparedFor.current = uid;
    const owner = await localOwner();
    if (owner !== uid) {
      // Another account's copy (or an unclaimed one) is on this device. It's safe on the
      // server; drop it here so this account starts from its own data.
      await clearLocalData();
    }
    await setLocalOwner(uid);
    void sync.start(uid);
    setPhase({ kind: 'ready', session });
  }

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // Supabase calls back synchronously inside its own lock; defer our async work.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          setPhase({ kind: 'recovery', session });
        } else if (recovering.current) {
          // Waiting for the reset link's session; ignore the start-up events meanwhile.
        } else if (event === 'SIGNED_OUT' || !session) {
          preparedFor.current = null;
          if (phaseRef.current.kind !== 'signedOut') setPhase({ kind: 'signedOut' });
        } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          if (phaseRef.current.kind !== 'recovery' && !recovering.current) void prepare(session);
        }
      }, 0);
    });
    if (pendingRecovery?.tokens) {
      const backTo = pendingRecovery.backTo;
      void supabase.auth.setSession(pendingRecovery.tokens).then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data.session) {
          recovering.current = false;
          setPhase({ kind: 'signedOut', notice: 'That reset link has expired or was already used. Send a new one below.' });
        } else setPhase({ kind: 'recovery', session: data.session, backTo });
      });
      return () => {
        cancelled = true;
        sub.subscription.unsubscribe();
      };
    }
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      // Tidy the ?code=… left by an email link.
      if (hadCode.current) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
      if (!data.session) {
        setPhase({
          kind: 'signedOut',
          notice: pendingRecovery?.error
            ? pendingRecovery.error
            : hadCode.current
            ? 'If you just confirmed your email, sign in below. (Email links only sign you in automatically on the device where you created the account.)'
            : undefined,
        });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await sync.syncNow();
    const pending = sync.getStatus().pending;
    if (
      pending > 0 &&
      !confirm(
        `${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached the server yet (you may be offline). Signing out now will lose ${pending === 1 ? 'it' : 'them'}. Sign out anyway?`,
      )
    ) {
      return;
    }
    await sync.stop();
    await clearLocalData();
    preparedFor.current = null;
    await supabase.auth.signOut();
    setPhase({ kind: 'signedOut' });
  }

  switch (phase.kind) {
    case 'loading':
      return <Splash />;
    case 'signedOut':
      return <AuthScreen notice={phase.notice} />;
    case 'recovery':
      return (
        <SetPasswordScreen
          backTo={phase.backTo}
          onDone={() => {
            recovering.current = false;
            preparedFor.current = null;
            void prepare(phase.session);
          }}
        />
      );
    case 'ready':
      return <AuthContext.Provider value={{ session: phase.session, signOut }}>{children}</AuthContext.Provider>;
  }
}
