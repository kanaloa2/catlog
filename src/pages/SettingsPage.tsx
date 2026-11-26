import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { deleteAllData } from '../lib/repo';
import { useAuth } from '../auth/AuthGate';
import { Modal } from '../components/Modal';
import { ShortcutsPanel } from '../components/ShortcutsPanel';
import { DataversePanel } from '../dataverse/DataversePanel';
import { supabase } from '../supabase';
import { sync, useSyncStatus } from '../sync';
import { todayYmd } from '../lib/format';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const syncStatus = useSyncStatus();
  const [status, setStatus] = useState('');
  const counts = useLiveQuery(async () => ({ cats: await db.cats.filter((c) => !c.isSomebody).count(), events: await db.events.count() }));

  async function doExport() {
    const cats = (await db.cats.toArray()).map(({ photo, ...rest }) => ({ ...rest, hasPhoto: !!photo }));
    const byId = new Map(cats.map((c) => [c.id, c.name]));
    const events = (await db.events.orderBy('occurredAt').toArray()).map(({ photo, ...e }) => ({ ...e, cats: e.catIds.map((id) => byId.get(id) ?? id), hasPhoto: !!photo }));
    const data = { format: 'catlog-export', exportedAt: new Date().toISOString(), cats, events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `catlog-export-${todayYmd()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Export downloaded.');
  }

  return (
    <div className="page narrow">
      <h1 className="page-title">Settings</h1>

      <section className="panel">
        <h2>Account</h2>
        <p>
          Signed in as <strong>{session.user.email}</strong>
        </p>
        <p className="muted small">
          {syncStatus.pending
            ? `${syncStatus.pending} change${syncStatus.pending === 1 ? '' : 's'} waiting to sync.`
            : syncStatus.lastSyncedAt
              ? `Everything is synced (last checked ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}).`
              : 'Syncing…'}
          {syncStatus.rejected > 0 &&
            ` ${syncStatus.rejected} change${syncStatus.rejected === 1 ? ' was' : 's were'} rejected by the server (usually because something was deleted on another device).`}
        </p>
        <p className="muted small">To share CatLog with someone at home, sign in with this same account on their phone.</p>
        <div className="row-actions">
          <button className="btn btn-secondary" onClick={() => sync.syncNow()}>
            Sync now
          </button>
          <ChangePassword />
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>

      <ShortcutsPanel />

      <section className="panel">
        <h2>Your data</h2>
        <p className="muted">
          Your cats, events and photos are saved to your account, so you can sign in on any device. This device keeps a copy too, so
          CatLog works offline and syncs when you’re back online.
        </p>
        {counts && (
          <p className="small">
            {counts.cats} cat{counts.cats === 1 ? '' : 's'} · {counts.events.toLocaleString()} event{counts.events === 1 ? '' : 's'}
          </p>
        )}
        <div className="row-actions">
          <button className="btn btn-secondary" onClick={doExport}>
            Export as JSON
          </button>
        </div>
        {status && (
          <p className="success" role="status">
            {status}
          </p>
        )}
      </section>

      <DataversePanel />

      <section className="panel">
        <h2>Install</h2>
        <p className="muted">
          Add CatLog to your home screen so it opens like an app: in Safari tap Share, then Add to Home Screen. In Chrome, use the menu
          and choose Install app.
        </p>
      </section>

      <section className="panel danger-zone">
        <h2>Danger zone</h2>
        <p className="muted">Permanently deletes all your cats and events, on every device. Your account stays.</p>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (confirm('Delete ALL your cats and events, on every device? This can’t be undone.')) {
              await deleteAllData();
              navigate('/');
            }
          }}
        >
          Delete all data
        </button>
      </section>
    </div>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const close = () => {
    setOpen(false);
    setPw('');
    setError('');
  };
  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        {done ? 'Password updated ✓' : 'Change password'}
      </button>
      <Modal open={open} title="Change password" onClose={close}>
        <form
          className="form"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 8) return setError('Passwords must be at least 8 characters.');
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) return setError(error.message);
            setDone(true);
            close();
          }}
        >
          <div className="field">
            <label className="label" htmlFor="change-pw">
              New password
            </label>
            <input id="change-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <p className="hint">At least 8 characters. This is the same password you use for Packlist and Pickup.</p>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save password
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
