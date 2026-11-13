import { cva } from 'class-variance-authority';
import { useState } from 'react';

const avatar = cva(
  'inline-grid flex-none place-items-center overflow-hidden rounded-pill text-micro',
  {
    variants: {
      size: {
        // Where a person is the marker of a row, such as the timeline's comments.
        xl: 'size-32',
        lg: 'size-avatar-lg',
        // Beside a line of small text, such as an overview's byline.
        sm: 'size-20',
      },
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

export interface AvatarProps {
  login: string;
  size?: 'xl' | 'lg' | 'sm' | undefined;
  /**
   * The address of their picture. The initials show until it has loaded, and stay if it can't be.
   * Without one, only the initials show.
   */
  image?: string | undefined;
}

/**
 * A person's picture, as their initials in a hue of their own until the picture is there: pair it
 * with their login wherever they matter. It's decorative, since the login beside it says who it is.
 */
export function Avatar({ login, size = 'lg', image }: AvatarProps) {
  return (
    <span className={avatar({ size, hue: avatarHue(login) })} aria-hidden="true">
      {image === undefined || image === '' ? (
        initials(login)
      ) : (
        // A new address starts again from the initials.
        <Picture key={image} login={login} image={image} />
      )}
    </span>
  );
}

/**
 * The picture over the initials. The image is laid out from the start, unseen, so it loads at
 * once, and takes the initials' place only when it has.
 */
function Picture({ login, image }: { login: string; image: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <>
      {state !== 'loaded' && <span className="col-start-1 row-start-1">{initials(login)}</span>}
      {state !== 'failed' && (
        <img
          src={image}
          alt=""
          decoding="async"
          draggable={false}
          className={`col-start-1 row-start-1 size-full object-cover ${state === 'loaded' ? '' : 'opacity-0'}`}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </>
  );
}
