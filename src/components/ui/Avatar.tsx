import type { Person } from '@/domain/types';
import { cx } from '@/lib/cx';
import styles from './Avatar.module.css';

const PALETTE = ['#3646d4', '#128f7a', '#d9543f', '#8a5f00', '#7a3fc4', '#0b74a8', '#b23a7f', '#4a6b1e'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toLocaleUpperCase('pt-BR');
}

interface AvatarProps {
  person: Pick<Person, 'id' | 'name' | 'avatarUrl'>;
  size?: number;
  /** Destaca o avatar com um anel (por exemplo, pessoa editando). */
  ring?: boolean;
  title?: string;
}

export function Avatar({ person, size = 28, ring = false, title }: AvatarProps) {
  const color = colorFor(person.id);
  return (
    <span
      className={cx(styles.avatar, ring && styles.ring)}
      style={{ width: size, height: size, background: color, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={title ?? person.name}
      role="img"
      aria-label={title ?? person.name}
    >
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 28 }: { people: Person[]; max?: number; size?: number }) {
  const visible = people.slice(0, max);
  const hidden = people.length - visible.length;
  return (
    <span className={styles.stack}>
      {visible.map((person) => (
        <Avatar key={person.id} person={person} size={size} />
      ))}
      {hidden > 0 && (
        <span
          className={cx(styles.avatar, styles.more)}
          style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
          title={people
            .slice(max)
            .map((person) => person.name)
            .join(', ')}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
