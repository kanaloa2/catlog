import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCat, useCatEvents, useCats, useCatsById } from '../hooks';
import { CatAvatar } from '../components/CatAvatar';
import { CatForm } from '../components/CatForm';
import { EventRow } from '../components/EventRow';
import { useToast } from '../components/Toast';
import { Empty } from '../components/ui';
import { catStats } from '../lib/stats';
import { ago, formatStamp } from '../lib/format';
import { EVENT_TYPES, eventTitle, typeInfo } from '../lib/eventTypes';
import { addEvent, deleteCat, deleteEvent, moveCat, restoreEvent, ValidationError } from '../lib/repo';
import { shownPhoto } from '../lib/photo';

export function CatPage() {
  const { catId } = useParams();
  const cat = useCat(catId);
  const events = useCatEvents(catId);
  const cats = useCats();
  const catsById = useCatsById(cats);
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  if (cat === undefined || events === undefined) return null;
  if (cat === null)
    return (
      <Empty icon="🐾" title="Cat not found">
        <Link className="btn btn-secondary" to="/cats">
          Back to cats
        </Link>
      </Empty>
    );

  const s = catStats(events);
  const photo = shownPhoto(cat.photo);

  async function log(type: string) {
    const e = await addEvent({ type, catIds: [cat!.id], source: 'quick' });
    navigator.vibrate?.(30);
    toast(`Logged #${e.number}: ${eventTitle(e, catsById)}`, [
      {
        label: 'Undo',
        run: async () => {
          const gone = await deleteEvent(e.id);
          if (gone) toast('Removed', [{ label: 'Redo', run: () => restoreEvent(gone) }]);
        },
      },
      { label: 'Edit', to: `/events/${e.id}` },
    ]);
  }

  return (
    <div className="page narrow">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/cats">‹ Cats</Link>
      </nav>
      <section className={`cat-hero${photo ? ' has-photo' : ''}`}>
        {photo ? <img src={photo} alt="" className="cat-hero-img" /> : <CatAvatar cat={cat} size="xl" />}
        <div className="cat-hero-text">
          <h1>{cat.name}</h1>
          {cat.birthday && <p className="muted small">Born {new Date(cat.birthday + 'T12:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>}
          {cat.archived && <span className="pill">Archived</span>}
        </div>
      </section>

      <div className="stat-row">
        <Link to={`/events?cat=${cat.id}`} className="stat">
          <span className="stat-num">{s.total.toLocaleString()}</span>
          <span className="stat-label">All events</span>
        </Link>
        <div className="stat">
          <span className="stat-num">{s.thisMonth}</span>
          <span className="stat-label">This month</span>
        </div>
        <div className="stat">
          <span className="stat-num">{s.last30}</span>
          <span className="stat-label">Last 30 days</span>
        </div>
      </div>

      {s.byType.length > 0 && (
        <div className="chips chips-wrap type-counts">
          {s.byType.map(([t, n]) => (
            <Link key={t} to={`/events?cat=${cat.id}&type=${encodeURIComponent(t)}`} className="chip chip-type on" style={{ ['--type-color' as string]: typeInfo(t).color }}>
              {typeInfo(t).emoji} {t} <strong>{n.toLocaleString()}</strong>
            </Link>
          ))}
        </div>
      )}
      {s.last && (
        <p className="muted small">
          Last event: {formatStamp(s.last.occurredAt)} ({ago(s.last.occurredAt)})
        </p>
      )}

      {!cat.archived && (
        <section className="panel">
          <h2>Log for {cat.name}</h2>
          <div className="quick-actions">
            {EVENT_TYPES.map((t) => (
              <button key={t.name} className="quick-btn" style={{ ['--type-color' as string]: t.color }} onClick={() => log(t.name)}>
                <span aria-hidden>{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {cat.notes && (
        <section className="panel">
          <h2>Notes</h2>
          <p className="notes">{cat.notes}</p>
        </section>
      )}

      <section>
        <div className="section-header">
          <h2>Recent</h2>
          {events.length > 20 && (
            <Link to={`/events?cat=${cat.id}`} className="link-btn">
              See all {events.length.toLocaleString()} ›
            </Link>
          )}
        </div>
        {events.length ? (
          <ul className="event-list">
            {events.slice(0, 20).map((e) => (
              <EventRow key={e.id} event={e} catsById={catsById} showDate />
            ))}
          </ul>
        ) : (
          <p className="muted">No events yet.</p>
        )}
      </section>

      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => setEditing(true)}>
          Edit
        </button>
        {!cat.isSomebody && !cat.archived && (
          <>
            <button className="btn btn-ghost" onClick={() => moveCat(cat.id, -1)} title="Move earlier in the cat row">
              ← Move
            </button>
            <button className="btn btn-ghost" onClick={() => moveCat(cat.id, 1)} title="Move later in the cat row">
              Move →
            </button>
          </>
        )}
        {!cat.isSomebody && (
          <button
            className="btn btn-danger"
            onClick={async () => {
              const msg =
                events.length > 0
                  ? `Delete ${cat.name}? Their ${events.length.toLocaleString()} event${events.length === 1 ? '' : 's'} stay, and any with no other cat go to Somebody. To just hide ${cat.name}, edit and choose Archived instead.`
                  : `Delete ${cat.name}?`;
              if (!confirm(msg)) return;
              try {
                await deleteCat(cat.id);
                navigate('/cats', { replace: true });
              } catch (e) {
                alert(e instanceof ValidationError ? e.message : (e as Error).message);
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
      {editing && <CatForm cat={cat} onClose={() => setEditing(false)} />}
    </div>
  );
}
