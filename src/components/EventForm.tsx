import { useState } from 'react';
import type { CatEvent } from '../types';
import { useCats, useEvents } from '../hooks';
import { addEvent, updateEvent, ValidationError } from '../lib/repo';
import { allTypes, typeInfo } from '../lib/eventTypes';
import { nowLocal } from '../lib/format';
import { CatAvatar } from './CatAvatar';
import { Modal } from './Modal';
import { PhotoField } from './PhotoField';

export interface EventDefaults {
  catIds?: string[];
  type?: string;
  occurredAt?: string;
}

/** Add or edit an event: who (one or more cats, or Somebody), what, when, notes and a photo. */
export function EventForm({
  event,
  defaults,
  onClose,
  onSaved,
}: {
  event?: CatEvent;
  defaults?: EventDefaults;
  onClose: () => void;
  onSaved?: (e: CatEvent | undefined) => void;
}) {
  const cats = useCats();
  const events = useEvents();
  const somebody = cats?.find((c) => c.isSomebody);
  const [catIds, setCatIds] = useState<string[]>(event?.catIds ?? defaults?.catIds ?? []);
  const [type, setType] = useState(event?.type ?? defaults?.type ?? 'Pooed');
  const [custom, setCustom] = useState('');
  const [occurredAt, setOccurredAt] = useState(event?.occurredAt ?? defaults?.occurredAt ?? nowLocal());
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [photo, setPhoto] = useState<string | undefined>(event?.photo);
  const [error, setError] = useState('');
  const types = allTypes(events);
  const choices = (cats ?? []).filter((c) => !c.archived || catIds.includes(c.id));

  function toggle(id: string) {
    if (id === somebody?.id) return setCatIds([id]);
    const without = catIds.filter((x) => x !== somebody?.id);
    setCatIds(without.includes(id) ? without.filter((x) => x !== id) : [...without, id]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const input = { type: custom.trim() || type, catIds, occurredAt, notes, photo };
      if (event) {
        await updateEvent(event.id, input);
        onSaved?.(undefined);
      } else {
        onSaved?.(await addEvent(input));
      }
      onClose();
    } catch (err) {
      setError(err instanceof ValidationError ? err.message : (err as Error).message);
    }
  }

  return (
    <Modal open title={event ? 'Edit event' : 'Add event'} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        <fieldset className="field">
          <legend className="label">Who</legend>
          <div className="cat-choices">
            {choices.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`cat-choice${catIds.includes(c.id) ? ' on' : ''}`}
                aria-pressed={catIds.includes(c.id)}
                onClick={() => toggle(c.id)}
              >
                <CatAvatar cat={c} size="md" />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          <p className="hint">Tap more than one if they both did it. Not sure? Pick Somebody, or leave it empty.</p>
        </fieldset>
        <fieldset className="field">
          <legend className="label">What</legend>
          <div className="chips chips-wrap">
            {types.map((t) => (
              <button
                type="button"
                key={t}
                className={`chip chip-type${type === t && !custom ? ' on' : ''}`}
                aria-pressed={type === t && !custom}
                style={{ ['--type-color' as string]: typeInfo(t).color }}
                onClick={() => {
                  setType(t);
                  setCustom('');
                }}
              >
                {typeInfo(t).emoji} {t}
              </button>
            ))}
          </div>
          <input type="text" placeholder="Something else…" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Other event type" maxLength={40} />
        </fieldset>
        <div className="field">
          <label className="label" htmlFor="ev-when">
            When
          </label>
          <div className="when-row">
            <input id="ev-when" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value.slice(0, 16))} />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setOccurredAt(nowLocal())}>
              Now
            </button>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="ev-notes">
            Notes
          </label>
          <textarea id="ev-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where, what it looked like…" />
        </div>
        <div className="field">
          <span className="label">Photo</span>
          <PhotoField value={photo} onChange={setPhoto} />
        </div>
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
            {event ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
