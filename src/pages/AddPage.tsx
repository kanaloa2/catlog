import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCats, useCatsById, useEvent } from '../hooks';
import { addEvent, deleteEvent } from '../lib/repo';
import { eventTitle, normalizeType } from '../lib/eventTypes';
import { EventForm } from '../components/EventForm';
import { EventAvatar } from '../components/CatAvatar';
import { catsOf } from '../lib/eventTypes';
import { formatWhen, LOCAL_DT } from '../lib/format';
import type { Cat } from '../types';

/** Splits "Stormy & The Bandit", "stormy,bandit" or "stormy and bandit" into names. */
export function splitNames(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|\+|\/|\s+and\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Finds cats by name (case-insensitive, "The" optional) or id. Returns the ones it found and the names it didn't. */
export function resolveCats(names: string[], cats: Cat[]): { found: Cat[]; missing: string[] } {
  const strip = (s: string) => s.trim().toLowerCase().replace(/^the\s+/, '');
  const found: Cat[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const v = strip(n);
    const c =
      cats.find((x) => x.id === n) ??
      cats.find((x) => !x.archived && strip(x.name) === v) ??
      (/^(somebody|someone|unknown|\?)$/.test(v) ? cats.find((x) => x.isSomebody) : undefined);
    if (c) {
      if (!found.includes(c)) found.push(c);
    } else missing.push(n);
  }
  return { found, missing };
}

/**
 * Deep link for shortcuts: #/add?cat=Stormy&type=poo
 *   save=1  logs it straight away and shows a confirmation (otherwise the form opens filled in)
 *   at=YYYY-MM-DDTHH:mm  a time other than now
 */
export function AddPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cats = useCats();
  const done = useRef(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ catIds: string[]; type: string; occurredAt?: string } | null>(null);

  useEffect(() => {
    if (!cats || done.current) return;
    done.current = true;
    const { found, missing } = resolveCats(splitNames(params.get('cat') ?? params.get('cats') ?? ''), cats);
    const type = normalizeType(params.get('type') ?? '');
    const at = params.get('at') ?? '';
    const occurredAt = LOCAL_DT.test(at) ? at : undefined;
    if (missing.length) setError(`CatLog doesn’t have a cat named ${missing.map((m) => `“${m}”`).join(' or ')}. Check the spelling in your shortcut.`);
    if (params.get('save') === '1' && !missing.length) {
      addEvent({ type, catIds: found.map((c) => c.id), occurredAt, source: 'shortcut' })
        .then((e) => navigate(`/added/${e.id}`, { replace: true }))
        .catch((e) => setError((e as Error).message));
    } else {
      setForm({ catIds: found.map((c) => c.id), type, occurredAt });
    }
  }, [cats]);

  return (
    <div className="page narrow">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <EventForm
          defaults={form}
          onClose={() => navigate('/', { replace: true })}
          onSaved={(e) => e && navigate(`/added/${e.id}`, { replace: true })}
        />
      )}
    </div>
  );
}

/** "Logged #3515: Stormy Pooed", after a shortcut or the add form. */
export function AddedPage({ id }: { id: string }) {
  const event = useEvent(id);
  const cats = useCats();
  const catsById = useCatsById(cats);
  const navigate = useNavigate();
  if (event === undefined) return null;
  if (event === null)
    return (
      <div className="page narrow center">
        <p className="muted">That event was removed.</p>
        <Link className="btn btn-primary" to="/">
          Back to the calendar
        </Link>
      </div>
    );
  return (
    <div className="page narrow center added">
      <EventAvatar cats={catsOf(event, catsById)} type={event.type} size="lg" />
      <h1>{eventTitle(event, catsById)}</h1>
      <p className="muted">
        {event.number !== null ? `#${event.number} · ` : ''}
        {formatWhen(event.occurredAt)}
      </p>
      <div className="center-actions">
        <Link className="btn btn-primary" to="/" replace>
          Done
        </Link>
        <Link className="btn btn-secondary" to={`/events/${event.id}`}>
          Edit
        </Link>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await deleteEvent(event.id);
            navigate('/', { replace: true });
          }}
        >
          Undo
        </button>
      </div>
    </div>
  );
}
