import { cva } from 'class-variance-authority';

const avatar = cva(
  'inline-grid size-avatar-lg flex-none place-items-center overflow-hidden rounded-pill text-micro',
  {
    variants: {
      hue: {
        1: 'bg-avatar-1-bg text-avatar-1',
        2: 'bg-avatar-2-bg text-avatar-2',
        3: 'bg-avatar-3-bg text-avatar-3',
        4: 'bg-avatar-4-bg text-avatar-4',
        5: 'bg-avatar-5-bg text-avatar-5',
        6: 'bg-avatar-6-bg text-avatar-6',
      },
    },
  },
);

/** One of the six hues, from a hash of `login`, so a person keeps theirs. */
export function avatarHue(login: string): 1 | 2 | 3 | 4 | 5 | 6 {
  let hash = 2166136261;
  for (const letter of login.toLowerCase()) {
    hash = Math.imul(hash ^ (letter.codePointAt(0) ?? 0), 16777619);
  }
  const hues = [1, 2, 3, 4, 5, 6] as const;
  return hues[(hash >>> 0) % hues.length] ?? 1;
}

/** Up to two letters for `login`: the first of its first two parts, or its first two. */
export function initials(login: string): string {
  const parts = login.split(/[-_.]+/).filter(Boolean);
  const [first = '', second] = parts;
  const letters = second === undefined ? first.slice(0, 2) : `${first[0] ?? ''}${second[0] ?? ''}`;
  return letters.toUpperCase();
}

/**
 * A person's picture, as their initials in a hue of their own: pair it with their login wherever
 * they matter. It's decorative, since the login beside it says who it is.
 */
export function Avatar({ login }: { login: string }) {
  return (
    <span className={avatar({ hue: avatarHue(login) })} aria-hidden="true">
      {initials(login)}
    </span>
  );
}
