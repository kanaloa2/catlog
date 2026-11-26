import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCats, useEvents } from '../hooks';
import { CatAvatar } from '../components/CatAvatar';
import { CatForm } from '../components/CatForm';
import { catStats } from '../lib/stats';
import { ago } from '../lib/format';
import { typeInfo } from '../lib/eventTypes';
import type { Cat, CatEvent } from '../types';

export function CatsPage() {
  const cats = useCats();
  const events = useEvents();
  const [adding, setAdding] = useState(false);
  const byCat = useMemo(() => {
    const m = new Map<string, CatEvent[]>();
    for (const e of events ?? []) for (const id of e.catIds) (m.get(id) ?? m.set(id, []).get(id)!).push(e);
    return m;
  }, [events]);
  const active = (cats ?? []).filter((c) => !c.archived);
  const archived = (cats ?? []).filter((c) => c.archived);

  return (
    <div className="page">
      <div className="section-header">
        <h1 className="page-title">Cats</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + Add cat
        </button>
      </div>
      <ul className="cat-grid">
        {active.map((c) => (
          <CatCard key={c.id} cat={c} events={byCat.get(c.id) ?? []} />
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="archived">
          <summary>Archived ({archived.length})</summary>
          <ul className="cat-grid">
            {archived.map((c) => (
              <CatCard key={c.id} cat={c} events={byCat.get(c.id) ?? []} />
            ))}
          </ul>
        </details>
      )}
      {adding && <CatForm onClose={() => setAdding(false)} />}
    </div>
  );
}

function CatCard({ cat, events }: { cat: Cat; events: CatEvent[] }) {
  const s = catStats(events);
  return (
    <li>
      <Link to={`/cats/${cat.id}`} className="cat-card">
        <CatAvatar cat={cat} size="xl" />
        <span className="cat-card-name">{cat.name}</span>
        <span className="cat-card-total">
          <strong>{s.total.toLocaleString()}</strong> event{s.total === 1 ? '' : 's'}
        </span>
        <span className="cat-card-types">
          {s.byType.slice(0, 3).map(([t, n]) => (
            <span key={t}>
              {typeInfo(t).emoji} {n.toLocaleString()}
            </span>
          ))}
        </span>
        <span className="muted small">{s.last ? `Last: ${ago(s.last.occurredAt)}` : 'No events yet'}</span>
      </Link>
    </li>
  );
}
