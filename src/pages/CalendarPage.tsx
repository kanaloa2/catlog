import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCats, useCatsById, useEventsBetween } from '../hooks';
import { CatAvatar } from '../components/CatAvatar';
import { EventRow } from '../components/EventRow';
import { EventForm } from '../components/EventForm';
import { useToast } from '../components/Toast';
import { formatLongDay, nowLocal, todayYmd } from '../lib/format';
import { typeInfo, eventTitle } from '../lib/eventTypes';
import { deleteEvent, restoreEvent } from '../lib/repo';
import type { CatEvent } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The home page: the cat row, a month of dots, and the chosen day's events. */
export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = todayYmd();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : today;
  const catFilter = params.get('cat') ?? '';
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const cats = useCats();
  const catsById = useCatsById(cats);
  const visibleCats = (cats ?? []).filter((c) => !c.archived);

  // The 6-week grid around the chosen day's month.
  const first = parseYmd(day.slice(0, 8) + '01');
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  // Drop a trailing week that's entirely next month.
  const weeks = cells[35].getMonth() !== first.getMonth() ? 5 : 6;
  const gridFrom = ymd(cells[0]);
  const gridTo = ymd(cells[weeks * 7 - 1]);
  const events = useEventsBetween(gridFrom, gridTo);

  const filtered = useMemo(() => (events ?? []).filter((e) => !catFilter || e.catIds.includes(catFilter)), [events, catFilter]);
  const byDay = useMemo(() => {
    const m = new Map<string, CatEvent[]>();
    for (const e of filtered) {
      const k = e.occurredAt.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [filtered]);
  const dayEvents = byDay.get(day) ?? [];
  const monthKey = day.slice(0, 7);
  const monthCount = filtered.filter((e) => e.occurredAt.startsWith(monthKey)).length;

  function go(next: Partial<{ d: string; cat: string }>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (p.get('d') === today) p.delete('d');
    setParams(p, { replace: true });
  }

  function shiftMonth(n: number) {
    const d = parseYmd(day);
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), last));
    go({ d: ymd(target) });
  }

  // Swipe the grid sideways to change month.
  const touch = useRef<{ x: number; y: number } | null>(null);

  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const defaultWhen = day === today ? nowLocal() : `${day}T${nowLocal().slice(11)}`;

  return (
    <div className="page calendar-page">
      <div className="cat-row" role="toolbar" aria-label="Show one cat">
        {visibleCats.map((c) => (
          <button
            key={c.id}
            className={`cat-row-btn${catFilter === c.id ? ' on' : ''}${catFilter && catFilter !== c.id ? ' dim' : ''}`}
            aria-pressed={catFilter === c.id}
            title={c.name}
            onClick={() => go({ cat: catFilter === c.id ? '' : c.id })}
          >
            <CatAvatar cat={c} size="md" />
            <span className="cat-row-name">{c.name}</span>
          </button>
        ))}
        {visibleCats.filter((c) => !c.isSomebody).length === 0 && (
          <Link to="/cats" className="btn btn-secondary btn-small">
            Add your cats
          </Link>
        )}
      </div>

      <div className="month-head">
        <button className="icon-btn month-nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <h1 className="month-title">{monthLabel}</h1>
        {day !== today && (
          <button className="btn btn-small btn-secondary today-btn" onClick={() => go({ d: today })}>
            Today
          </button>
        )}
        <button className="icon-btn month-nav" aria-label="Next month" onClick={() => shiftMonth(1)}>
          ›
        </button>
      </div>

      <div
        className="cal"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
        }}
      >
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="cal-wd" aria-hidden>
            {w}
          </div>
        ))}
        {cells.slice(0, weeks * 7).map((d) => {
          const key = ymd(d);
          const list = byDay.get(key) ?? [];
          const other = d.getMonth() !== first.getMonth();
          return (
            <button
              key={key}
              className={`cal-day${other ? ' other' : ''}${key === day ? ' sel' : ''}${key === today ? ' today' : ''}`}
              onClick={() => go({ d: key })}
              aria-label={`${d.toDateString()}, ${list.length} event${list.length === 1 ? '' : 's'}`}
              aria-pressed={key === day}
            >
              <span className="cal-num">{d.getDate()}</span>
              <span className="cal-dots" aria-hidden>
                {list.slice(0, 4).map((e) => (
                  <span key={e.id} className="dot" style={{ background: typeInfo(e.type).color }} />
                ))}
                {list.length > 4 && <span className="dot-more">+</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="day-bar">
        <h2>{formatLongDay(day)}</h2>
        <button className="icon-btn add-btn" aria-label="Add an event on this day" onClick={() => setAdding(true)}>
          +
        </button>
      </div>

      {dayEvents.length ? (
        <ul className="event-list">
          {[...dayEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((e) => (
            <EventRow key={e.id} event={e} catsById={catsById} />
          ))}
        </ul>
      ) : (
        <p className="muted center day-empty">
          No kitty events{catFilter ? ` for ${catsById.get(catFilter)?.name}` : ''}.{' '}
          <button className="link-btn" onClick={() => setAdding(true)}>
            Add one
          </button>
        </p>
      )}

      <p className="cal-footer">
        Kitty Events: {dayEvents.length} <span className="muted">· {monthCount} this month</span>
      </p>

      {adding && (
        <EventForm
          defaults={{ occurredAt: defaultWhen, catIds: catFilter ? [catFilter] : [] }}
          onClose={() => setAdding(false)}
          onSaved={(e) =>
            e &&
            toast(`Logged ${eventTitle(e, catsById)}`, [
              {
                label: 'Undo',
                run: async () => {
                  const gone = await deleteEvent(e.id);
                  if (gone) toast('Removed', [{ label: 'Redo', run: () => restoreEvent(gone) }]);
                },
              },
            ])
          }
        />
      )}
    </div>
  );
}
