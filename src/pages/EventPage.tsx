import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCats, useCatsById, useEvent } from '../hooks';
import { CatAvatar, EventAvatar } from '../components/CatAvatar';
import { EventForm } from '../components/EventForm';
import { WhoPicker } from '../components/WhoPicker';
import { useToast } from '../components/Toast';
import { Empty } from '../components/ui';
import { catsOf, eventTitle, isUnknown, typeInfo } from '../lib/eventTypes';
import { ago, formatStamp } from '../lib/format';
import { deleteEvent, restoreEvent, setEventCats } from '../lib/repo';
import { shownPhoto } from '../lib/photo';

const SOURCE_LABEL: Record<string, string> = {
  app: 'Added in CatLog',
  quick: 'Quick add',
  shortcut: 'Shortcut',
  email: 'From an email',
  import: 'Imported from Dataverse',
};

export function EventPage() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const cats = useCats();
  const catsById = useCatsById(cats);
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  if (event === undefined || cats === undefined) return null;
  if (event === null)
    return (
      <Empty icon="🐾" title="Event not found">
        <Link className="btn btn-secondary" to="/">
          Back to the calendar
        </Link>
      </Empty>
    );

  const who = catsOf(event, catsById);
  const unknown = isUnknown(event, catsById);
  const info = typeInfo(event.type);
  const realCats = cats.filter((c) => !c.archived && !c.isSomebody);
  const photo = shownPhoto(event.photo);

  async function quickAssign(id: string) {
    const before = event!.catIds;
    await setEventCats(event!.id, [id]);
    toast(`Changed to ${catsById.get(id)?.name}`, [{ label: 'Undo', run: () => setEventCats(event!.id, before) }]);
  }

  return (
    <div className="page narrow">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/?d=${event.occurredAt.slice(0, 10)}`}>‹ Calendar</Link>
      </nav>
      <section className="event-hero" style={{ ['--type-color' as string]: info.color }}>
        <EventAvatar cats={who} type={event.type} size="lg" />
        <div>
          <p className="kicker">
            <span className="type-badge">
              {info.emoji} {event.type}
            </span>
            {event.number !== null && <span className="muted"> #{event.number}</span>}
          </p>
          <h1>{eventTitle(event, catsById)}</h1>
          <p className="muted">
            {formatStamp(event.occurredAt)} · {ago(event.occurredAt)}
          </p>
        </div>
      </section>

      {unknown && realCats.length > 0 && (
        <section className="panel who-panel">
          <h2>Who did it?</h2>
          <p className="muted small">Tap the cat to change this event.</p>
          <div className="who-grid">
            {realCats.map((c) => (
              <button key={c.id} className="who-cat" onClick={() => quickAssign(c.id)}>
                <CatAvatar cat={c} size="lg" />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          {realCats.length > 1 && (
            <button className="btn btn-secondary btn-small" onClick={() => setPicking(true)}>
              It was more than one
            </button>
          )}
        </section>
      )}

      <section className="panel">
        <div className="section-header">
          <h2>{who.length > 1 ? 'Cats' : 'Cat'}</h2>
          <button className="btn btn-small btn-secondary" onClick={() => setPicking(true)}>
            Change
          </button>
        </div>
        <ul className="who-list">
          {who.map((c) => (
            <li key={c.id}>
              <Link to={`/cats/${c.id}`} className="who-link">
                <CatAvatar cat={c} size="md" />
                <span>{c.name}</span>
                <span className="chev" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {(event.notes || photo) && (
        <section className="panel">
          <h2>Notes</h2>
          {event.notes && <p className="notes">{event.notes}</p>}
          {photo && <img className="event-photo" src={photo} alt="" />}
        </section>
      )}

      <p className="muted small">{SOURCE_LABEL[event.source] ?? ''}</p>

      <div className="row-actions">
        <button className="btn btn-primary" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            const gone = await deleteEvent(event.id);
            navigate(`/?d=${event.occurredAt.slice(0, 10)}`, { replace: true });
            if (gone) toast('Event deleted', [{ label: 'Undo', run: () => restoreEvent(gone) }]);
          }}
        >
          Delete
        </button>
      </div>

      {editing && <EventForm event={event} onClose={() => setEditing(false)} />}
      {picking && <WhoPicker event={event} onClose={() => setPicking(false)} />}
    </div>
  );
}
