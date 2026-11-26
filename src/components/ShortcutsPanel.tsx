import { useEffect, useState } from 'react';
import { useCats } from '../hooks';
import { appUrl, supabase } from '../supabase';
import { createKey, deleteKey, forgetKey, hasWorkerApi, listKeys, logText, rememberKey, savedKey, addUrl, RPC_URL, LOG_RPC_URL, PUBLIC_KEY, sha256Hex, type ShortcutKey } from '../lib/shortcuts';
import { ago } from '../lib/format';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          prompt('Copy this:', text);
        }
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

/** Settings → Shortcuts: a key for iOS Shortcuts, links per cat, and how to set them up. */
export function ShortcutsPanel() {
  const cats = useCats();
  const [keys, setKeys] = useState<ShortcutKey[] | null>(null);
  const [key, setKey] = useState(savedKey);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [api, setApi] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');

  async function refresh() {
    try {
      const list = await listKeys();
      setKeys(list);
      setError('');
    } catch (e) {
      setError(`Couldn’t load your shortcut keys: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    void refresh();
    void hasWorkerApi().then((ok) => setApi(ok ? location.origin : ''));
  }, []);

  // Does the key saved on this device still exist in the account?
  useEffect(() => {
    if (!key || !keys) return setKeyValid(null);
    let off = false;
    sha256Hex(key).then(async (h) => {
      const { count } = await supabase.from('catlog_shortcut_keys').select('id', { count: 'exact', head: true }).eq('key_hash', h);
      if (!off) setKeyValid((count ?? 0) > 0);
    });
    return () => {
      off = true;
    };
  }, [key, keys]);

  async function make() {
    setBusy(true);
    try {
      const k = await createKey(`${navigator.platform || 'Device'} shortcuts`);
      setKey(k);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = (cats ?? []).filter((c) => !c.archived);
  const usable = key && keyValid !== false;

  return (
    <section className="panel" id="shortcuts">
      <h2>Shortcuts</h2>
      <p className="muted">
        Log an event in one tap without opening CatLog: from the iPhone Action button, Back Tap, Siri, a Home Screen or Lock Screen
        widget, or an Apple Watch. It uses a shortcut key instead of your password.
      </p>

      {!usable ? (
        <div className="row-actions">
          <button className="btn btn-primary" disabled={busy} onClick={make}>
            {keys?.length ? 'Make a key for this device' : 'Make a shortcut key'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const k = prompt('Paste a shortcut key you made on another device:')?.trim();
              if (k) {
                rememberKey(k);
                setKey(k);
              }
            }}
          >
            I have a key
          </button>
        </div>
      ) : (
        <>
          <h3>Your links</h3>
          <p className="muted small">
            Each link logs one event the moment it’s opened. Use “Somebody” when you don’t know who did it; you can change it later.
          </p>
          {api === null ? (
            <p className="muted small">Checking…</p>
          ) : api ? (
            <ul className="link-list">
              {active.flatMap((c) =>
                ['Pooed', 'Barfed'].map((t) => (
                  <li key={c.id + t}>
                    <span>
                      {t === 'Pooed' ? '💩' : '🤮'} {c.name} {t.toLowerCase()}
                    </span>
                    <CopyButton text={addUrl(api, key, c.name, t)} label="Copy link" />
                  </li>
                )),
              )}
            </ul>
          ) : (
            <div className="callout">
              <p className="small">
                This copy of CatLog has no link service, so shortcuts call your account directly. In Shortcuts use{' '}
                <strong>Get Contents of URL</strong> with:
              </p>
              <ul className="small kv">
                <li>
                  URL: <code>{RPC_URL}</code> <CopyButton text={RPC_URL} />
                </li>
                <li>Method: POST, Request Body: JSON</li>
                <li>
                  Header <code>apikey</code>: <code className="wrap">{PUBLIC_KEY}</code> <CopyButton text={PUBLIC_KEY} />
                </li>
                <li>
                  JSON: <code>p_key</code> = your key <CopyButton text={key} label="Copy key" />, <code>p_cats</code> = Stormy,{' '}
                  <code>p_type</code> = Pooed
                </li>
              </ul>
            </div>
          )}

          <details className="howto" open>
            <summary>Set one up on iPhone or iPad</summary>
            <ol className="small">
              <li>Copy a link above.</li>
              <li>
                Open the <strong>Shortcuts</strong> app, tap <strong>+</strong>, then <strong>Add Action</strong>.
              </li>
              <li>
                Search for <strong>Get Contents of URL</strong>, add it and paste the link into it.
              </li>
              <li>
                Optional: add <strong>Show Notification</strong> and choose <strong>Contents of URL</strong>, so you see “Logged #3513: Stormy
                Pooed”.
              </li>
              <li>Tap the name at the top and call it something you’d say to Siri, like “Stormy pooed”.</li>
              <li>
                To run it from anywhere: Settings, Action Button, Shortcut (iPhone 15 Pro and later); Settings, Accessibility, Touch, Back Tap;
                or long-press the Home Screen or Lock Screen, add a widget and pick Shortcuts.
              </li>
            </ol>
            <p className="muted small">
              One shortcut for everything: add <strong>Choose from Menu</strong> with a choice per cat, and a Get Contents of URL in each
              choice. To open CatLog on the quick-add screen instead, use <strong>Open URLs</strong> with{' '}
              <code>{appUrl()}#/quick</code>.
            </p>
          </details>

          <h3>Log from text</h3>
          <p className="muted small">
            Type or paste lines like “Stormy pooed” or “Luna &amp; The Bandit barfed”. Each line that names a cat is logged. This is what
            email logging does with your messages.
          </p>
          <div className="inline-form">
            <textarea rows={2} value={pasted} placeholder="Stormy pooed" onChange={(e) => setPasted(e.target.value)} />
            <button
              className="btn btn-secondary"
              disabled={!pasted.trim() || busy}
              onClick={async () => {
                setBusy(true);
                const r = await logText(key, pasted);
                setBusy(false);
                setError(r.ok ? '' : r.message);
                if (r.ok) {
                  setPasted('');
                  alert(r.message);
                }
              }}
            >
              Log it
            </button>
          </div>
          <details className="howto">
            <summary>For email automations</summary>
            <p className="small">
              Send the email’s subject and text to {api ? <code>{api}/api/log?k=…</code> : <code>{LOG_RPC_URL}</code>} as a POST
              {api ? (
                <>
                  {' '}
                  with the text as the body. <CopyButton text={`${api}/api/log?k=${encodeURIComponent(key)}`} label="Copy address" />
                </>
              ) : (
                <> with the apikey header above and JSON p_key and p_text.</>
              )}
            </p>
          </details>
        </>
      )}

      {keys && keys.length > 0 && (
        <details className="howto">
          <summary>
            Keys on your account <span className="muted small">({keys.length})</span>
          </summary>
          <ul className="link-list">
            {keys.map((k) => (
              <li key={k.id}>
                <span className="small">
                  {k.label} · made {ago(k.created_at.slice(0, 16))} · {k.last_used_at ? `used ${ago(k.last_used_at.slice(0, 16))}` : 'not used yet'}
                </span>
                <button
                  className="btn btn-small btn-danger"
                  onClick={async () => {
                    if (!confirm('Delete this key? Shortcuts that use it will stop working.')) return;
                    await deleteKey(k.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {key && (
            <div className="row-actions">
              <CopyButton text={key} label="Copy this device’s key" />
              <button
                className="btn btn-small btn-ghost"
                onClick={() => {
                  forgetKey();
                  setKey('');
                }}
              >
                Forget it on this device
              </button>
            </div>
          )}
        </details>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
