import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCats, useCatsById, useEvents } from '../hooks';
import { CatAvatar } from '../components/CatAvatar';
import { EventRow } from '../components/EventRow';
import { allTypes, eventTitle, isUnknown, typeInfo } from '../lib/eventTypes';
import { monthLabel, todayYmd } from '../lib/format';
import type { Cat, CatEvent } from '../types';

const PAGE = 150;

export interface EventFilter {
  q: string;
  cats: string[];
  types: string[];
  from: string;
  to: string;
  unknown: boolean;
}

/** Applies search text and filters. Several cats = events involving any of them. */
export function filterEvents(events: CatEvent[], f: EventFilter, catsById: Map<string, Cat>): CatEvent[] {
  const q = f.q.trim().toLowerCase();
  const num = /^#?(\d+)$/.exec(q)?.[1];
  return events.filter((e) => {
    if (f.cats.length && !e.catIds.some((id) => f.cats.includes(id))) return false;
    if (f.types.length && !f.types.includes(e.type)) return false;
    const d = e.occurredAt.slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.unknown && !isUnknown(e, catsById)) return false;
    if (q) {
      if (num && String(e.number) === num) return true;
      const hay = `${eventTitle(e, catsById)} ${e.notes} ${e.occurredAt.slice(0, 10)}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

const PRESETS: [string, () => [string, string]][] = [
  ['7 days', () => [shift(-6), todayYmd()]],
  ['30 days', () => [shift(-29), todayYmd()]],
  ['This year', () => [`${todayYmd().slice(0, 4)}-01-01`, todayYmd()]],
];
function shift(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayYmd(d);
}

/** Search and filter every event: by cat, type, date range, or still-unknown culprit. */
export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const events = useEvents();
  const cats = useCats();
  const catsById = useCatsById(cats);
  const [limit, setLimit] = useState(PAGE);
  const f: EventFilter = {
    q: params.get('q') ?? '',
    cats: (params.get('cat') ?? '').split(',').filter(Boolean),
    types: (params.get('type') ?? '').split(',').filter(Boolean),
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    unknown: params.get('unknown') === '1',
  };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
    setLimit(PAGE);
  };
  const toggle = (k: 'cat' | 'type', list: string[], v: string) => set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(','));

  const results = useMemo(() => (events && cats ? filterEvents(events, f, catsById) : []), [events, cats, params]);
  const types = allTypes(events);
  const active = f.cats.length + f.types.length + (f.from || f.to ? 1 : 0) + (f.unknown ? 1 : 0);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of results) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [results]);

  const groups: { label: string; items: CatEvent[] }[] = [];
  for (const e of results.slice(0, limit)) {
    const label = monthLabel(e.occurredAt);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return (
    <div className="page">
      <h1 className="page-title">Events</h1>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search: cat, poo, barf, notes, #3512…"
          value={f.q}
          onChange={(e) => set('q', e.target.value)}
          aria-label="Search events"
          enterKeyHint="search"
        />
      </div>

      <div className="filters">
        <div className="chips chips-scroll" role="group" aria-label="Cats">
          {(cats ?? [])
            .filter((c) => !c.archived || f.cats.includes(c.id))
            .map((c) => (
              <button key={c.id} className={`chip chip-cat${f.cats.includes(c.id) ? ' on' : ''}`} aria-pressed={f.cats.includes(c.id)} onClick={() => toggle('cat', f.cats, c.id)}>
                <CatAvatar cat={c} size="xs" /> {c.name}
              </button>
            ))}
        </div>
        <div className="chips chips-scroll" role="group" aria-label="Types">
          {types.map((t) => (
            <button
              key={t}
              className={`chip chip-type${f.types.includes(t) ? ' on' : ''}`}
              style={{ ['--type-color' as string]: typeInfo(t).color }}
              aria-pressed={f.types.includes(t)}
              onClick={() => toggle('type', f.types, t)}
            >
              {typeInfo(t).emoji} {t}
            </button>
          ))}
          <button className={`chip${f.unknown ? ' on' : ''}`} aria-pressed={f.unknown} onClick={() => set('unknown', f.unknown ? '' : '1')}>
            ❓ Who? only
          </button>
        </div>
        <div className="date-filter">
          <label>
            <span className="label">From</span>
            <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label>
            <span className="label">To</span>
            <input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
          </label>
          <div className="chips">
            {PRESETS.map(([label, range]) => (
              <button
                key={label}
                className="chip"
                onClick={() => {
                  const [a, b] = range();
                  const p = new URLSearchParams(params);
                  p.set('from', a);
                  p.set('to', b);
                  setParams(p, { replace: true });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {(active > 0 || f.q) && (
          <button className="link-btn" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear search and filters
          </button>
        )}
      </div>

      <p className="result-count">
        <strong>{results.length.toLocaleString()}</strong> event{results.length === 1 ? '' : 's'}
        {byType.length > 0 && (
          <span className="muted">
            {' · '}
            {byType
              .slice(0, 4)
              .map(([t, n]) => `${typeInfo(t).emoji} ${n}`)
              .join('  ')}
          </span>
        )}
      </p>

      {groups.map((g) => (
        <section key={g.label} className="month-group">
          <h2 className="group-title">{g.label}</h2>
          <ul className="event-list">
            {g.items.map((e) => (
              <EventRow key={e.id} event={e} catsById={catsById} showDate />
            ))}
          </ul>
        </section>
      ))}
      {results.length > limit && (
        <p className="center">
          <button className="btn btn-secondary" onClick={() => setLimit(limit + PAGE * 2)}>
            Show more ({(results.length - limit).toLocaleString()} left)
          </button>
        </p>
      )}
      {events && results.length === 0 && <p className="muted center">Nothing matches.</p>}
    </div>
  );
}
