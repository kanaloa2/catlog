import type { Cat } from '../types';
import { shownPhoto } from '../lib/photo';
import { catColor, typeInfo } from '../lib/eventTypes';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** A cat's round photo, or its initial on its color. Somebody shows a question mark. */
export function CatAvatar({ cat, size = 'md', ring }: { cat: Cat | undefined; size?: Size; ring?: boolean }) {
  const photo = shownPhoto(cat?.photo);
  const cls = `avatar avatar-${size}${ring ? ' avatar-ring' : ''}`;
  if (photo) return <img className={cls} src={photo} alt="" loading="lazy" />;
  const color = cat ? catColor(cat) : '#64748b';
  return (
    <span className={`${cls} avatar-initial`} style={{ background: color }} aria-hidden>
      {!cat || cat.isSomebody ? '?' : cat.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The cats who did it, overlapping, with the event type's emoji in the corner. */
export function EventAvatar({ cats, type, size = 'md' }: { cats: Cat[]; type: string; size?: 'sm' | 'md' | 'lg' }) {
  const shown = cats.slice(0, 3);
  const info = typeInfo(type);
  return (
    <span className={`event-avatar event-avatar-${size} n${Math.max(1, shown.length)}`} aria-hidden>
      {shown.length === 0 ? (
        <CatAvatar cat={undefined} size={size === 'lg' ? 'lg' : size === 'md' ? 'md' : 'sm'} />
      ) : (
        shown.map((c) => <CatAvatar key={c.id} cat={c} size={shown.length > 1 ? (size === 'lg' ? 'md' : 'sm') : size === 'lg' ? 'lg' : size === 'md' ? 'md' : 'sm'} ring={shown.length > 1} />)
      )}
      <span className="event-emoji">{info.emoji}</span>
    </span>
  );
}
