import { cva } from 'class-variance-authority';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

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
        // Inside a line of small text, as a term's byline is.
        xs: 'size-16',
      },
      hue: {
        1: 'bg-avatar-1-bg text-avatar-1',
        2: 'bg-avatar-2-bg text-avatar-2',
        3: 'bg-avatar-3-bg text-avatar-3',
        4: 'bg-avatar-4-bg text-avatar-4',
        5: 'bg-avatar-5-bg text-avatar-5',
        6: 'bg-avatar-6-bg text-avatar-6',
        // Their picture, on its way: an empty disc, with no initials.
        none: 'bg-bg-raised',
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

/** How big an avatar is drawn: `lg` beside a comment, `sm` beside small text, `xs` inside it. */
export type AvatarSize = 'xl' | 'lg' | 'sm' | 'xs';

export interface AvatarProps {
  login: string;
  size?: AvatarSize | undefined;
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
  return <Drawn login={login} size={size} image={image} />;
}

/**
 * An avatar with an address: the one it's given, or the one `redrawPictures` gave for it since,
 * each drawn from the empty disc.
 */
function Drawn({ login, size, image }: { login: string; size: AvatarSize; image: string }) {
  const address = useSyncExternalStore(watchRedraws, () => replaced.get(image) ?? image);
  useLayoutEffect(() => {
    drawing.set(image, (drawing.get(image) ?? 0) + 1);
    return () => {
      const left = (drawing.get(image) ?? 1) - 1;
      if (left > 0) drawing.set(image, left);
      else drawing.delete(image);
    };
  }, [image]);
  return <Picture key={address} login={login} size={size} image={address} />;
}

/**
 * The pictures the window has drawn, by address: drawn again, as a card is when its thread
 * collapses, one comes back as it loads, without the move a picture new to the window makes.
 */
const drawnBefore = new Set<string>();

/** The addresses avatars are given, each with how many on screen are. */
const drawing = new Map<string, number>();
/** What `redrawPictures` gave for an address, which its avatars draw instead. */
const replaced = new Map<string, string>();
/** The avatars watching `replaced`. */
const watchers = new Set<() => void>();

function watchRedraws(changed: () => void): () => void {
  watchers.add(changed);
  return () => {
    watchers.delete(changed);
  };
}

/**
 * Has each avatar whose address `change` gives a new one for draw that one instead, on screen now
 * or later, as a picture new to the window: the empty disc, then the picture with the Swap, or the
 * initials if it can't be loaded. For a picture that changed behind its address: the window keeps
 * each picture it has drawn by its address, whatever the answer said, so only a new address loads
 * it anew.
 */
export function redrawPictures(change: (address: string) => string | undefined): void {
  let changed = false;
  for (const address of new Set([...drawing.keys(), ...replaced.keys(), ...drawnBefore])) {
    const now = change(address);
    if (now === undefined || now === (replaced.get(address) ?? address)) continue;
    replaced.set(address, now);
    changed = true;
  }
  if (!changed) return;
  for (const watcher of watchers) watcher();
}

/** How a picture is laid in its disc. */
const PICTURE = 'size-full object-cover';

/**
 * The pictures kept ready, by address: how many ask for it, and an image of it, loading or loaded,
 * for the next avatar that draws it to take.
 */
const ready = new Map<string, { asks: number; image: HTMLImageElement }>();

/**
 * An image of the picture at `address`, out of the page, loading: decoded as the frame that first
 * draws it is, so that frame has it.
 */
function readyImage(address: string): HTMLImageElement {
  const image = new Image();
  image.alt = '';
  image.decoding = 'sync';
  image.draggable = false;
  image.className = PICTURE;
  image.addEventListener('load', () => drawnBefore.add(address), { once: true });
  image.src = address;
  return image;
}

/**
 * Keeps the picture at `address` ready for the next avatar that draws it, until the function it
 * returns is called as often as this was.
 */
function keepReady(address: string): () => void {
  const kept = ready.get(address) ?? { asks: 0, image: readyImage(address) };
  kept.asks += 1;
  ready.set(address, kept);
  return () => {
    kept.asks -= 1;
    if (kept.asks === 0 && ready.get(address) === kept) ready.delete(address);
  };
}

/**
 * The image of the picture at `address` kept ready, once it has loaded, for an avatar drawing it
 * now, which takes it, and another is made ready in its place.
 */
function takeReady(address: string): HTMLImageElement | undefined {
  const kept = ready.get(address);
  if (!kept?.image.complete || kept.image.naturalWidth === 0) return undefined;
  const { image } = kept;
  kept.image = readyImage(address);
  return image;
}

/**
 * Keeps the picture at `address` ready while the caller is drawn, for an avatar about to appear,
 * as the one on a comment the moment it's sent: it takes the image kept ready, loaded, and draws
 * the picture from its first frame. A new avatar's own image, even of a picture on screen, can load
 * a frame after it's drawn, which shows an empty disc meanwhile.
 */
export function useReadyPicture(address: string | undefined): void {
  useEffect(() => (address === undefined ? undefined : keepReady(address)), [address]);
}

/**
 * The picture, in an empty disc until it has loaded, which it then fades in over (Swap), or the
 * initials if it can't be loaded. The image is laid out from the start, unseen, so it loads at
 * once. One the window already holds shows from the first frame, and one it has drawn before
 * comes back without the move. One kept ready (`useReadyPicture`), loaded, is taken and shown from
 * the first frame.
 */
function Picture({ login, size, image }: { login: string; size: AvatarSize; image: string }) {
  // Taken as it's first drawn, once: drawn twice in development, the second finds none loaded.
  const [taken] = useState(() => takeReady(image));
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(taken ? 'loaded' : 'loading');
  const disc = useRef<HTMLSpanElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  // Whether the window hadn't drawn the picture before this avatar was, and so it fades in as it
  // loads: read as it's first drawn, so every avatar new with it fades in, not only the first.
  const fresh = useRef(false);
  // Whether it loaded after it was drawn, and so fades in.
  const arrived = useRef(false);
  // The image taken goes in its disc before the frame is painted.
  useLayoutEffect(() => {
    if (taken) disc.current?.append(taken);
  }, [taken]);
  useLayoutEffect(() => {
    if (taken) return;
    fresh.current = !drawnBefore.has(image);
    const drawn = picture.current;
    if (!drawn?.complete || drawn.naturalWidth === 0) return;
    drawnBefore.add(image);
    setState('loaded');
  }, [image, taken]);
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
  if (taken) {
    return <span ref={disc} className={avatar({ size, hue: 'none' })} aria-hidden="true" />;
  }
  return (
    <span className={avatar({ size, hue: 'none' })} aria-hidden="true">
      <img
        ref={picture}
        src={image}
        alt=""
        decoding="async"
        draggable={false}
        className={`${PICTURE} ${state === 'loaded' ? '' : 'opacity-0'}`}
        onLoad={() => {
          if (state !== 'loading') return;
          arrived.current = fresh.current;
          drawnBefore.add(image);
          setState('loaded');
        }}
        onError={() => setState('failed')}
      />
    </span>
  );
}
