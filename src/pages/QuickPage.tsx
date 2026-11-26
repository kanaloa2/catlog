import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCats, useCatsById } from '../hooks';
import { CatAvatar } from '../components/CatAvatar';
import { EventForm } from '../components/EventForm';
import { useToast } from '../components/Toast';
import { addEvent, deleteEvent, restoreEvent } from '../lib/repo';
import { EVENT_TYPES, eventTitle } from '../lib/eventTypes';

const QUICK_TYPES = EVENT_TYPES.slice(0, 2); // Pooed, Barfed

/** One tap per cat to log "Stormy Pooed" right now, with Undo. */
export function QuickPage() {
  const cats = useCats();
  const catsById = useCatsById(cats);
  const toast = useToast();
  const [form, setForm] = useState<{ catIds: string[] } | null>(null);
  const visible = (cats ?? []).filter((c) => !c.archived);

  async function log(catId: string, type: string) {
    const e = await addEvent({ type, catIds: [catId], source: 'quick' });
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
    <div className="page">
      <h1 className="page-title">Quick add</h1>
      <p className="muted small">One tap logs it now. You can change the time or the cat afterwards.</p>
      {visible.filter((c) => !c.isSomebody).length === 0 && (
        <p>
          <Link className="btn btn-primary" to="/cats">
            Add your cats first
          </Link>
        </p>
      )}
      <ul className="quick-grid">
        {visible.map((c) => (
          <li key={c.id} className="quick-card">
            <Link to={`/cats/${c.id}`} className="quick-cat">
              <CatAvatar cat={c} size="lg" />
              <span className="quick-name">{c.name}</span>
            </Link>
            <div className="quick-actions">
              {QUICK_TYPES.map((t) => (
                <button key={t.name} className="quick-btn" style={{ ['--type-color' as string]: t.color }} onClick={() => log(c.id, t.name)}>
                  <span aria-hidden>{t.emoji}</span> {t.name}
                </button>
              ))}
              <button className="quick-btn quick-more" aria-label={`More for ${c.name}`} onClick={() => setForm({ catIds: [c.id] })}>
                …
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="center">
        <button className="btn btn-secondary" onClick={() => setForm({ catIds: [] })}>
          Several cats or something else…
        </button>
      </p>
      {form && (
        <EventForm
          defaults={form}
          onClose={() => setForm(null)}
          onSaved={(e) => e && toast(`Logged #${e.number}: ${eventTitle(e, catsById)}`, [{ label: 'Open', to: `/events/${e.id}` }])}
        />
      )}
    </div>
  );
}
