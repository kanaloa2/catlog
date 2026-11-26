import { useState } from 'react';
import type { Cat } from '../types';
import { createCat, updateCat, ValidationError } from '../lib/repo';
import { Modal } from './Modal';
import { PhotoField } from './PhotoField';

/** Add or edit a cat: name, photo, birthday, color and notes. */
export function CatForm({ cat, onClose, onSaved }: { cat?: Cat; onClose: () => void; onSaved?: (c: Cat | undefined) => void }) {
  const [name, setName] = useState(cat?.name ?? '');
  const [photo, setPhoto] = useState<string | undefined>(cat?.photo);
  const [birthday, setBirthday] = useState(cat?.birthday ?? '');
  const [color, setColor] = useState(cat?.color ?? '');
  const [notes, setNotes] = useState(cat?.notes ?? '');
  const [archived, setArchived] = useState(cat?.archived ?? false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const input = { name, photo, birthday, color, notes, archived };
      if (cat) {
        await updateCat(cat.id, input);
        onSaved?.(undefined);
      } else onSaved?.(await createCat(input));
      onClose();
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : (err as Error).message);
    }
  }

  return (
    <Modal open title={cat ? `Edit ${cat.name}` : 'Add a cat'} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <div className="field">
          <label className="label" htmlFor="cat-name">
            Name
          </label>
          <input id="cat-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoCapitalize="words" />
        </div>
        <div className="field">
          <span className="label">Photo</span>
          <PhotoField value={photo} onChange={setPhoto} />
        </div>
        {!cat?.isSomebody && (
          <div className="field">
            <label className="label" htmlFor="cat-bday">
              Birthday
            </label>
            <input id="cat-bday" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="cat-color">
            Color
          </label>
          <div className="when-row">
            <input id="cat-color" type="color" value={color || '#2563eb'} onChange={(e) => setColor(e.target.value)} />
            {color && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setColor('')}>
                Automatic
              </button>
            )}
          </div>
          <p className="hint">Used when there’s no photo.</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="cat-notes">
            Notes
          </label>
          <textarea id="cat-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {cat && !cat.isSomebody && (
          <label className="toggle">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (hidden from the cat row and pickers; past events keep the name)
          </label>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {cat ? 'Save' : 'Add cat'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
