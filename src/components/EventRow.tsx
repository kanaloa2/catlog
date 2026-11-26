import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { Cat, CatEvent } from '../types';
import { catsOf, eventTitle, isUnknown } from '../lib/eventTypes';
import { formatTime, formatWhen } from '../lib/format';
import { EventAvatar } from './CatAvatar';
import { WhoPicker } from './WhoPicker';

/** One event in a list: cats, "Stormy Pooed", when, and its number. Unknown culprits get a "Who?" button. */
export function EventRow({ event, catsById, showDate = false }: { event: CatEvent; catsById: Map<string, Cat>; showDate?: boolean }) {
  const [picking, setPicking] = useState(false);
  const cats = catsOf(event, catsById);
  const unknown = isUnknown(event, catsById);
  return (
    <li className={`event-row${unknown ? ' event-unknown' : ''}`}>
      <Link to={`/events/${event.id}`} className="event-link">
        <EventAvatar cats={cats} type={event.type} />
        <span className="event-main">
          <span className="event-title">{eventTitle(event, catsById)}</span>
          <span className="event-when">{showDate ? formatWhen(event.occurredAt) : formatTime(event.occurredAt)}</span>
        </span>
        {event.number !== null && <span className="event-num">{event.number}</span>}
        <span className="chev" aria-hidden>
          ›
        </span>
      </Link>
      {unknown && (
        <button className="who-btn" onClick={() => setPicking(true)}>
          Who?
        </button>
      )}
      {picking && <WhoPicker event={event} onClose={() => setPicking(false)} />}
    </li>
  );
}
