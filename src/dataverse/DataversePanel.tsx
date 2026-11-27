import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountInfo } from '@azure/msal-browser';
import { checkConfig, loadConfig, redirectUri, saveConfig, type DataverseConfig } from './config';
import { currentAccount, friendlyAuthError, signIn, signOut } from './auth';
import { describeTables, listTables, summaryText, type ColumnSummary, type TableInfo } from './api';
import {
  applyPlan,
  buildPlan,
  cleanMapping,
  EMPTY_MAPPING,
  fetchSource,
  FIELD_LABELS,
  guessColumns,
  guessTables,
  isMicrosoftTable,
  preferLinkedEventTable,
  tablesLinkingTo,
  loadTableMeta,
  EVENT_FIELDS,
  CAT_FIELDS,
  type Mapping,
  type EventField,
  type Plan,
  type CatField,
  type TableMeta,
} from './catImporter';
import { useAuth } from '../auth/AuthGate';
import { joinNames } from '../lib/eventTypes';
import { reconcileSettings, saveAccountSettings } from './accountSettings';
import { saveReport } from './report';

const MAPPING_KEY = 'catlog.dataverse.mapping';

function loadMapping(): Mapping | null {
  try {
    const m = JSON.parse(localStorage.getItem(MAPPING_KEY) ?? 'null') as Mapping | null;
    return m && typeof m === 'object' && 'cat' in m && 'event' in m ? m : null;
  } catch {
    return null;
  }
}

function storeMapping(m: Mapping) {
  try {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable */
  }
}

/** Column types that make sense for each field (others are hidden from its picker). */
const FIELD_TYPES: Partial<Record<CatField | EventField, string[]>> = {
  birthday: ['DateTime'],
  cat1: ['Lookup', 'Customer'],
  cat2: ['Lookup', 'Customer'],
  cat3: ['Lookup', 'Customer'],
  occurredAt: ['DateTime'],
  number: ['Integer', 'Decimal', 'Double', 'BigInt', 'String'],
};
const TEXTISH = ['String', 'Memo', 'Picklist', 'Integer', 'Decimal', 'Double', 'Money', 'BigInt', 'Lookup', 'Customer'];

/**
 * Settings → Import from Dataverse: connect with Microsoft, choose (or accept the guessed)
 * cat and event tables and columns, preview, then import.
 */
export function DataversePanel() {
  const { session } = useAuth();
  const [config, setConfig] = useState<DataverseConfig & { updatedAt?: number }>(loadConfig);
  const [editing, setEditing] = useState(() => checkConfig(loadConfig()) !== null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [mapping, setMapping] = useState<Mapping>(() => loadMapping() ?? EMPTY_MAPPING);
  const [metas, setMetas] = useState<{ cat: TableMeta | null; event: TableMeta | null }>({ cat: null, event: null });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [, setAttempt] = useState(0);
  const attemptRef = useRef(0);

  const problem = checkConfig(config);

  // Use the settings saved to the account (entered on any device, or Packlist's connection).
  useEffect(() => {
    let cancelled = false;
    reconcileSettings({ ...loadConfig(), mapping: loadMapping() ?? undefined }).then(({ settings, uploaded }) => {
      if (cancelled || !settings) return;
      const { mapping: m, ...cfg } = settings;
      saveConfig(cfg);
      setConfig(cfg);
      if (m) {
        storeMapping(m);
        setMapping(m);
      }
      setEditing(checkConfig(cfg) !== null);
      if (uploaded) setSyncNote('Saved these settings to your account, so your other devices use them too.');
      else if (!settings.updatedAt && checkConfig(cfg) === null) setSyncNote('Using the same Dataverse connection as Packlist.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editing || problem) return;
    currentAccount(config)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [editing, config.clientId, config.tenantId]);

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    const mine = attemptRef.current;
    setBusy(what);
    setError('');
    try {
      const result = await fn();
      return attemptRef.current === mine ? result : undefined;
    } catch (e) {
      const msg = friendlyAuthError(e);
      if (attemptRef.current === mine) setError(msg);
      const raw = e as { errorCode?: string; message?: string };
      void saveReport(what, msg, { errorCode: raw?.errorCode ?? '', rawMessage: String(raw?.message ?? e).slice(0, 2000), ...context() });
    } finally {
      if (attemptRef.current === mine) setBusy('');
    }
  }

  function progress() {
    const mine = attemptRef.current;
    return (msg: string) => attemptRef.current === mine && setBusy(msg);
  }

  function persist(m: Mapping) {
    storeMapping(m);
    const cfg = { ...config, updatedAt: Date.now() };
    saveConfig(cfg);
    setConfig(cfg);
    saveAccountSettings({ ...cfg, mapping: m }).catch(() => {});
  }

  async function connect() {
    const acct = await run('Waiting for Microsoft sign-in…', () => signIn(config));
    if (acct) setAccount(acct);
  }

  /** Loads the table list and the chosen tables' columns, guessing anything not chosen yet. */
  async function chooseTables() {
    setPlan(null);
    setDone('');
    const result = await run('Looking for your cat and event tables…', async () => {
      const list = await listTables(config);
      const saved = loadMapping();
      const known = (name?: string) => (name && list.some((t) => t.logicalName === name) ? name : '');
      const guess = guessTables(list);
      // A saved pick of one of Microsoft's own tables was an earlier, wrong guess: kitty events never live there.
      const keep = (name: string | undefined) => (name && isMicrosoftTable(name) ? '' : known(name));
      const catTable = keep(saved?.catTable) || guess.catTable;
      let eventTable = keep(saved?.eventTable);
      if (!eventTable && catTable) eventTable = preferLinkedEventTable(list, await tablesLinkingTo(config, catTable), guess.eventTable);
      eventTable ||= guess.eventTable;
      const next = await loadMetas(list, catTable, eventTable, saved);
      return { list, ...next };
    });
    if (result) {
      setTables(result.list);
      setMetas(result.metas);
      setMapping(result.mapping);
    }
  }

  async function loadMetas(list: TableInfo[], catTable: string, eventTable: string, saved: Mapping | null) {
    const find = (n: string) => list.find((t) => t.logicalName === n);
    const ct = find(catTable);
    const et = find(eventTable);
    const [cat, event] = await Promise.all([ct ? loadTableMeta(config, ct) : null, et ? loadTableMeta(config, et) : null]);
    const guessed = guessColumns(cat, event);
    let m: Mapping = { catTable, eventTable, ...guessed };
    // Keep saved column choices for tables that haven't changed.
    if (saved) {
      const clean = cleanMapping(saved, cat, event);
      const sameCat = saved.catTable === catTable;
      const sameEvent = saved.eventTable === eventTable;
      m = {
        catTable,
        eventTable,
        cat: sameCat ? { ...guessed.cat, ...clean.cat } : guessed.cat,
        event: sameEvent && sameCat ? { ...guessed.event, ...clean.event } : guessed.event,
        catLink: sameEvent && sameCat && saved.catLink !== undefined ? clean.catLink : guessed.catLink,
      };
    }
    return { metas: { cat, event }, mapping: m };
  }

  async function changeTable(which: 'catTable' | 'eventTable', value: string) {
    if (!tables) return;
    setPlan(null);
    const next = { ...mapping, [which]: value };
    // Re-guess the columns of the table that changed (and the event's cat links); keep the rest.
    const result = await run('Reading the table’s columns…', () =>
      loadMetas(tables, next.catTable, next.eventTable, { ...next, cat: which === 'catTable' ? {} : mapping.cat, event: {}, catLink: undefined }),
    );
    if (result) {
      setMetas(result.metas);
      setMapping(result.mapping);
    }
  }

  async function preview() {
    setDone('');
    setPlan(null);
    if (!metas.cat && !metas.event) return setError('Choose a cat table, an event table, or both.');
    persist(mapping);
    const say = progress();
    const p = await run('Reading your data…', async () => buildPlan(await fetchSource(config, mapping, metas, {}, say), mapping, metas, session.user.id));
    if (p) setPlan(p);
  }

  async function doImport() {
    if (!plan) return;
    setImporting(true);
    const say = progress();
    const r = await run('Importing…', () => applyPlan(config, plan, { includePhotos, onProgress: say }));
    setImporting(false);
    if (r) {
      const n = (c: number, one: string) => `${c} ${one}${c === 1 ? '' : 's'}`;
      setDone(
        `Imported ${n(r.cats, 'cat')} and ${n(r.events, 'event')}` +
          (includePhotos && plan.photos.length ? ` with ${n(r.photos, 'photo')}` : '') +
          '. It’s syncing to your account now.' +
          (r.merged ? ` ${n(r.merged, 'cat')} matched ones you’d already added, so they were updated.` : '') +
          (r.numbered ? ` ${n(r.numbered, 'event')} had no number, so they got the next ones.` : '') +
          (r.photoFailures ? ` ${n(r.photoFailures, 'photo')} couldn’t be downloaded: ${r.firstPhotoError ?? 'unknown error'}` : ''),
      );
      setPlan(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Couldn’t copy automatically. Select the text below and copy it.');
    }
  }

  /** What the import was looking at: names and choices only, no row data. */
  function context(): Record<string, unknown> {
    return {
      environment: config.envUrl,
      signedIn: !!account,
      tables: tables?.map((t) => `${t.displayName} (${t.logicalName})`),
      mapping,
      catColumns: metas.cat?.columns.map((c) => `${c.name}:${c.type}`),
      eventColumns: metas.event?.columns.map((c) => `${c.name}:${c.type}`),
      eventLinks: metas.event?.links,
      images: { cat: metas.cat?.image ?? null, event: metas.event?.image ?? null },
    };
  }

  async function sendDetails() {
    setReportNote('');
    const result = await run('Gathering table details…', async () => {
      const list = tables ?? (await listTables(config));
      if (!tables) setTables(list);
      const picked = list.filter((t) => t.logicalName === mapping.catTable || t.logicalName === mapping.eventTable);
      const described = picked.length ? await describeTables(config, picked) : [];
      if (described.length) setSummary(summaryText(config.envUrl, described));
      const ok = await saveReport('Shared table details', error, {
        ...context(),
        tables: list.map((t) => `${t.displayName} (${t.logicalName})`),
        described,
      });
      return ok;
    });
    if (result === true) setReportNote('Saved to your account. Tell Claude and it can read them, no pasting needed.');
    else if (result === false) setReportNote('Couldn’t save the details. Check you’re online and try again.');
  }

  const setCat = (f: CatField, v: string) => {
    setPlan(null);
    setMapping({ ...mapping, cat: { ...mapping.cat, [f]: v } });
  };
  const setEvent = (f: EventField, v: string) => {
    setPlan(null);
    setMapping({ ...mapping, event: { ...mapping.event, [f]: v } });
  };

  return (
    <section className="panel">
      <h2>Import from Dataverse</h2>
      <p className="muted">
        Bring in your cats (with their pictures) and kitty events from your Dataverse tables. You’ll see a preview first.
        Importing again later updates what was imported instead of making copies.
      </p>

      {editing ? (
        <form
          className="form dv-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return setError(problem);
            const clean = { envUrl: config.envUrl.trim(), clientId: config.clientId.trim(), tenantId: config.tenantId.trim(), updatedAt: Date.now() };
            saveConfig(clean);
            setConfig(clean);
            setEditing(false);
            saveAccountSettings({ ...clean, mapping })
              .then(() => setSyncNote('Saved to your account. Your other devices use these settings too.'))
              .catch(() => setSyncNote('Saved on this device. It’ll be added to your account next time you open this online.'));
            setError('');
          }}
        >
          <div className="field">
            <label className="label" htmlFor="dv-env">
              Environment URL
            </label>
            <input id="dv-env" type="text" value={config.envUrl} onChange={(e) => setConfig({ ...config, envUrl: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="dv-client">
              Application (client) ID
            </label>
            <input
              id="dv-client"
              type="text"
              placeholder="From your Entra app registration’s Overview page"
              value={config.clientId}
              onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="dv-tenant">
              Directory (tenant) ID
            </label>
            <input
              id="dv-tenant"
              type="text"
              placeholder="Also on the Overview page"
              value={config.tenantId}
              onChange={(e) => setConfig({ ...config, tenantId: e.target.value })}
            />
          </div>
          <p className="hint">
            In the Entra app, add <code>{redirectUri()}</code> as a single-page application redirect URI.
          </p>
          <div className="row-actions">
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="small">
            {config.envUrl.replace(/^https:\/\//, '')}
            {account ? ` · signed in as ${account.username}` : ''}{' '}
            <button className="link-btn" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
          <div className="row-actions">
            {account ? (
              <>
                <button className={tables ? 'btn btn-secondary' : 'btn btn-primary'} disabled={!!busy} onClick={chooseTables}>
                  {tables ? 'Reload tables' : 'Find my tables'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!!busy}
                  onClick={async () => {
                    await run('Signing out…', () => signOut(config));
                    setAccount(null);
                    setTables(null);
                    setPlan(null);
                    setSummary('');
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={!!busy} onClick={connect}>
                Sign in with Microsoft
              </button>
            )}
          </div>
        </>
      )}

      {busy && (
        <p className="muted small" role="status">
          {busy}{' '}
          {!importing && (
            <button
              className="link-btn"
              onClick={() => {
                attemptRef.current++;
                setAttempt(attemptRef.current);
                setBusy('');
              }}
            >
              Cancel
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {syncNote && !editing && (
        <p className="muted small" role="status">
          {syncNote}
        </p>
      )}
      {done && (
        <p className="success" role="status">
          {done} <Link to="/">See the calendar →</Link>
        </p>
      )}

      {account && tables && !editing && (
        <div className="dv-mapping">
          {tables.length === 0 ? (
            <p className="small">No custom tables found in this environment.</p>
          ) : (
            <>
              <div className="dv-map-grid">
                <TablePick id="dv-ct" label="Cats table" tables={tables} value={mapping.catTable} disabled={!!busy} onChange={(v) => changeTable('catTable', v)} />
                <TablePick id="dv-et" label="Events table" tables={tables} value={mapping.eventTable} disabled={!!busy} onChange={(v) => changeTable('eventTable', v)} />
              </div>

              {metas.cat && (
                <details className="dv-columns" open={!mapping.cat.name}>
                  <summary>
                    Cat columns <span className="muted small">{countMapped(mapping.cat)} matched</span>
                  </summary>
                  <div className="dv-map-grid">
                    {CAT_FIELDS.map((f) => (
                      <ColumnPick key={f} field={f} meta={metas.cat!} value={mapping.cat[f] ?? ''} onChange={(v) => setCat(f, v)} />
                    ))}
                  </div>
                  <p className="muted small">Picture: {metas.cat.image ? metas.cat.image.column : 'no image column found'}</p>
                </details>
              )}
              {metas.event && (
                <details className="dv-columns" open={!mapping.event.cat1 && !mapping.catLink && !mapping.event.catNames}>
                  <summary>
                    Event columns <span className="muted small">{countMapped(mapping.event) + (mapping.catLink ? 1 : 0)} matched</span>
                  </summary>
                  <div className="dv-map-grid">
                    {metas.cat && metas.event.links.some((l) => l.with === metas.cat!.logicalName) && (
                      <div className="field">
                        <label className="label" htmlFor="dv-link">
                          Cats (many-to-many)
                        </label>
                        <select id="dv-link" value={mapping.catLink ?? ''} onChange={(e) => (setPlan(null), setMapping({ ...mapping, catLink: e.target.value }))}>
                          <option value="">Don’t use</option>
                          {metas.event.links
                            .filter((l) => l.with === metas.cat!.logicalName)
                            .map((l) => (
                              <option key={l.nav} value={l.nav}>
                                {l.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    {EVENT_FIELDS.filter((f) => !f.startsWith('cat') || f === 'catNames' || metas.cat).map((f) => (
                      <ColumnPick
                        key={f}
                        field={f}
                        meta={metas.event!}
                        value={mapping.event[f] ?? ''}
                        onChange={(v) => setEvent(f, v)}
                        lookupTarget={f.startsWith('cat') && f !== 'catNames' ? metas.cat?.logicalName : undefined}
                      />
                    ))}
                  </div>
                  <p className="muted small">
                    When an event doesn’t say which cat or what happened, its title is read instead (like “Stormy &amp; The Bandit Pooed”).
                  </p>
                </details>
              )}

              <div className="row-actions">
                <button className="btn btn-primary" disabled={!!busy} onClick={preview}>
                  {plan ? 'Refresh preview' : 'Preview import'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {plan && !busy && <ImportPreview plan={plan} includePhotos={includePhotos} setIncludePhotos={setIncludePhotos} onImport={doImport} />}

      {(account || error) && !editing && (
        <details className="dv-advanced" open={!!error}>
          <summary>Trouble importing? Share the details</summary>
          <p className="muted small">
            Saves the table and column names CatLog sees, your column choices and the last error to your account, so Claude
            can read them. No cat or event data is included.
          </p>
          <div className="row-actions">
            <button
              className="btn btn-small btn-secondary"
              disabled={!!busy}
              onClick={() =>
                account
                  ? sendDetails()
                  : saveReport('Shared error', error, context()).then((ok) =>
                      setReportNote(ok ? 'Saved to your account. Tell Claude and it can read it, no pasting needed.' : 'Couldn’t save the details. Check you’re online and try again.'),
                    )
              }
            >
              Save details for Claude
            </button>
            {summary && (
              <button className="btn btn-small btn-ghost" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy table details'}
              </button>
            )}
          </div>
          {reportNote && (
            <p className="muted small" role="status">
              {reportNote}
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function countMapped(cols: Record<string, string | undefined>) {
  return Object.values(cols).filter(Boolean).length;
}

function TablePick(props: { id: string; label: string; tables: TableInfo[]; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label className="label" htmlFor={props.id}>
        {props.label}
      </label>
      <select id={props.id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">None</option>
        {props.tables.map((t) => (
          <option key={t.logicalName} value={t.logicalName}>
            {t.displayName} ({t.logicalName})
          </option>
        ))}
      </select>
    </div>
  );
}

function ColumnPick(props: {
  field: CatField | EventField;
  meta: TableMeta;
  value: string;
  onChange: (v: string) => void;
  lookupTarget?: string;
}) {
  const types = FIELD_TYPES[props.field] ?? TEXTISH;
  const fits = (c: ColumnSummary) => types.includes(c.type) && (!props.lookupTarget || !c.targets || c.targets.includes(props.lookupTarget));
  const cols = [...props.meta.columns].filter(fits).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  const id = `dv-col-${props.meta.logicalName}-${props.field}`;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {FIELD_LABELS[props.field]}
      </label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Don’t import</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>
            {c.label || c.name} ({c.type})
          </option>
        ))}
      </select>
    </div>
  );
}

function ImportPreview({
  plan,
  includePhotos,
  setIncludePhotos,
  onImport,
}: {
  plan: Plan;
  includePhotos: boolean;
  setIncludePhotos: (v: boolean) => void;
  onImport: () => void;
}) {
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
  const names = plan.cats.filter((c) => !c.isSomebody).slice(0, 8).map((c) => c.name);
  const sorted = [...plan.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const range = sorted.length ? `${sorted[0].occurredAt.slice(0, 10)} to ${sorted[sorted.length - 1].occurredAt.slice(0, 10)}` : '';
  const types = new Map<string, number>();
  for (const e of plan.events) types.set(e.type, (types.get(e.type) ?? 0) + 1);
  return (
    <div className="dv-preview">
      <h3>Ready to import</h3>
      <ul className="dv-counts">
        <li>{n(plan.cats.length, 'cat')}</li>
        <li>{n(plan.events.length, 'event')}</li>
        {[...types].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => (
          <li key={t}>
            {c} {t}
          </li>
        ))}
      </ul>
      {names.length > 0 && (
        <p className="muted small">
          {joinNames(plan.cats.length > names.length ? [...names, `${plan.cats.length - names.length} more`] : names)}.
          {range && ` Events from ${range}.`}
        </p>
      )}
      {plan.warnings.length > 0 && (
        <details className="dv-notes">
          <summary>{n(plan.warnings.length, 'thing')} to know</summary>
          <ul>
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <label className="toggle">
        <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
        Include pictures ({plan.photos.length ? `${plan.photos.length} found in Dataverse` : 'none found in Dataverse'})
      </label>
      <div className="row-actions">
        <button className="btn btn-primary" disabled={!plan.cats.length && !plan.events.length} onClick={onImport}>
          Import
        </button>
      </div>
    </div>
  );
}
