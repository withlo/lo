import { cva } from 'class-variance-authority';
import { useLayoutEffect, useRef, useState } from 'react';

import { swapIn } from './Collapse.tsx';

const avatar = cva(
  'inline-grid flex-none place-items-center overflow-hidden rounded-pill text-micro',
  {
    variants: {
      size: {
        // Where a person is the marker of a row, such as the timeline's comments: smaller in a
        // narrow timeline (`tl-marker`).
        xl: 'tl-marker',
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
        // Their picture, on its way: an empty disc, with no initials.
        none: 'bg-raised',
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
   * The address of their picture. An empty disc shows until it has loaded, and their initials if it
   * can't be. Without one, only the initials show.
   */
  image?: string | undefined;
}

/**
 * A person's picture, or with none to show, their initials in a hue of their own: pair it with
 * their login wherever they matter. It's decorative, since the login beside it says who it is.
 */
export function Avatar({ login, size = 'lg', image }: AvatarProps) {
  if (image === undefined || image === '') {
    return (
      <span className={avatar({ size, hue: avatarHue(login) })} aria-hidden="true">
        {initials(login)}
      </span>
    );
  }
  // A new address starts again, from the empty disc.
  return <Picture key={image} login={login} size={size} image={image} />;
}

/**
 * The pictures the window has drawn, by address: drawn again, as a card is when its thread
 * collapses, one comes back as it loads, without the move a picture new to the window makes.
 */
const drawnBefore = new Set<string>();

/**
 * The picture, in an empty disc until it has loaded, which it then fades in over (Swap), or the
 * initials if it can't be loaded. The image is laid out from the start, unseen, so it loads at
 * once. One the window already holds shows from the first frame, and one it has drawn before
 * comes back without the move.
 */
function Picture({
  login,
  size,
  image,
}: {
  login: string;
  size: 'xl' | 'lg' | 'sm';
  image: string;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const picture = useRef<HTMLImageElement>(null);
  // Whether it loaded after it was drawn, and so fades in.
  const arrived = useRef(false);
  useLayoutEffect(() => {
    const drawn = picture.current;
    if (!drawn?.complete || drawn.naturalWidth === 0) return;
    drawnBefore.add(image);
    setState('loaded');
  }, [image]);
  // Once the picture's classes are drawn without what hid it, so the move stays on it.
  useLayoutEffect(() => {
    const drawn = picture.current;
    if (state !== 'loaded' || !arrived.current || !drawn) return undefined;
    arrived.current = false;
    return swapIn(drawn);
  }, [state]);
  if (state === 'failed') {
    return (
      <span className={avatar({ size, hue: avatarHue(login) })} aria-hidden="true">
        {initials(login)}
      </span>
    );
  }
  return (
    <span className={avatar({ size, hue: 'none' })} aria-hidden="true">
      <img
        ref={picture}
        src={image}
        alt=""
        decoding="async"
        draggable={false}
        className={`size-full object-cover ${state === 'loaded' ? '' : 'opacity-0'}`}
        onLoad={() => {
          if (state !== 'loading') return;
          arrived.current = !drawnBefore.has(image);
          drawnBefore.add(image);
          setState('loaded');
        }}
        onError={() => setState('failed')}
      />
    </span>
  );
}
