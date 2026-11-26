import { useState } from 'react';
import type { CatEvent } from '../types';
import { useCats } from '../hooks';
import { setEventCats } from '../lib/repo';
import { CatAvatar } from './CatAvatar';
import { Modal } from './Modal';
import { useToast } from './Toast';

/**
 * "Who did it?": one tap on a cat changes the event to that cat. "Pick several" lets you
 * choose more than one. Undo puts it back.
 */
export function WhoPicker({ event, onClose }: { event: CatEvent; onClose: () => void }) {
  const cats = useCats();
  const toast = useToast();
  const [multi, setMulti] = useState(false);
  const real = (cats ?? []).filter((c) => !c.archived && !c.isSomebody);
  const somebody = (cats ?? []).find((c) => c.isSomebody);
  const [picked, setPicked] = useState<string[]>(event.catIds.filter((id) => id !== somebody?.id));

  async function assign(ids: string[]) {
    const before = event.catIds;
    await setEventCats(event.id, ids);
    onClose();
    const names = ids.length ? real.filter((c) => ids.includes(c.id)).map((c) => c.name) : ['Somebody'];
    toast(`Changed to ${names.join(' & ')}`, [{ label: 'Undo', run: () => setEventCats(event.id, before) }]);
  }

  return (
    <Modal open title="Who did it?" onClose={onClose}>
      <div className="who-grid">
        {real.map((c) =>
          multi ? (
            <label key={c.id} className={`who-cat${picked.includes(c.id) ? ' on' : ''}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={picked.includes(c.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
              />
              <CatAvatar cat={c} size="lg" />
              <span>{c.name}</span>
            </label>
          ) : (
            <button key={c.id} className={`who-cat${event.catIds.includes(c.id) ? ' on' : ''}`} onClick={() => assign([c.id])}>
              <CatAvatar cat={c} size="lg" />
              <span>{c.name}</span>
            </button>
          ),
        )}
        {!multi && somebody && (
          <button className={`who-cat${event.catIds.includes(somebody.id) ? ' on' : ''}`} onClick={() => assign([])}>
            <CatAvatar cat={somebody} size="lg" />
            <span>Somebody</span>
          </button>
        )}
      </div>
      {real.length === 0 && <p className="muted">Add your cats first, on the Cats tab.</p>}
      <div className="form-actions">
        {multi ? (
          <>
            <button className="btn btn-ghost" onClick={() => setMulti(false)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!picked.length} onClick={() => assign(picked)}>
              Save {picked.length > 1 ? `${picked.length} cats` : ''}
            </button>
          </>
        ) : (
          real.length > 1 && (
            <button className="btn btn-secondary" onClick={() => setMulti(true)}>
              It was more than one
            </button>
          )
        )}
      </div>
    </Modal>
  );
}
