import { cva } from 'class-variance-authority';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button, type ButtonProps } from './Button.tsx';
import { Key, keyAria } from './Key.tsx';

/** How long a Copy button reads "Copied", or "Couldn’t copy", in milliseconds. */
export const COPIED_MS = 2000;

/** Puts `text` on the clipboard, and settles once it's there, or rejects when it couldn't. */
export type Copy = (text: string) => Promise<unknown>;

const Route = createContext<Copy>(() =>
  Promise.reject(new Error('Nothing here can copy: put a CopyRoute around the window.')),
);

export interface CopyRouteProps {
  /** How the window copies: in Lo, main's `tab.copy`. */
  copy: Copy;
  children?: ReactNode;
}

/**
 * Gives the pieces inside it the window's way to copy. The window may use no clipboard of its own,
 * since it's refused every permission, so it copies through main, and one `CopyRoute` goes around
 * the window to say how. `Problem`'s Copy goes through it, and so does anything that calls
 * `useCopy`.
 */
export function CopyRoute({ copy, children }: CopyRouteProps) {
  return <Route value={copy}>{children}</Route>;
}

/**
 * The window's way to copy, from the `CopyRoute` around it. Without one it rejects, so a Copy
 * button says it couldn't.
 */
export function useCopy(): Copy {
  return useContext(Route);
}

export interface CopyButtonProps extends Pick<ButtonProps, 'variant' | 'size'> {
  /**
   * What it says at rest: "Copy", or "Copy the log" where it isn't the only thing to copy. Words
   * only: a key goes in `keys`.
   */
  children?: ReactNode;
  /**
   * Its key, as the system shows each key of it, where the key works now: its chip goes after
   * whatever it says, the button's gap apart.
   */
  keys?: readonly string[] | undefined;
  /** That key as `aria-keyshortcuts` says it, for a screen reader, which never hears the chip. */
  shortcut?: string | undefined;
  /**
   * Copies, as a rule through `useCopy`. The button reads "Copied" once this is done, unless it
   * answers `false`, which says nothing was copied. When it throws or rejects, the button reads
   * "Couldn’t copy".
   */
  onCopy: () => unknown;
}

/** What a Copy button says after a press, for two seconds: "Copied", or "Couldn’t copy". */
export type CopySaid = 'copied' | 'failed';

/**
 * What a Copy button says now, and `say`, which makes it say "Copied" or "Couldn’t copy" for two
 * seconds from now. `say` is the same function throughout, for a copy made elsewhere, as by a key,
 * to answer on the button.
 */
export function useCopySaid(): readonly [CopySaid | undefined, (said: CopySaid) => void] {
  const [said, setSaid] = useState<CopySaid | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback((what: CopySaid) => {
    setSaid(what);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(undefined), COPIED_MS);
  }, []);
  return [said, say];
}

/**
 * One of the things the button says, with its key's chip after it as a button's gap apart, all in
 * one cell of its grid, so it's as wide as the widest, in the middle of it.
 */
const face = cva('col-start-1 row-start-1 inline-flex items-center justify-center', {
  variants: {
    size: { md: 'gap-6', sm: 'gap-4' },
    shown: { true: '', false: 'invisible' },
  },
});

export interface CopyFacesProps {
  said: CopySaid | undefined;
  /** What it says at rest, in words. */
  children: ReactNode;
  /**
   * The key's chip, which each of the three it says has after it: drawn in the face that shows, so
   * it stays beside the words, not beside the room the widest of them keeps.
   */
  chip?: ReactNode;
  /** The button's size, whose gap goes between the words and the chip. */
  size?: 'md' | 'sm' | null | undefined;
}

/**
 * What a Copy button says, inside it: `children` at rest, then "Copied" or "Couldn’t copy" as
 * `said` says, each with its key's `chip` after it. Each is in one cell, so the button is as wide
 * as the widest of the three throughout. Give it the chip rather than putting one beside it: beside
 * it, the chip sits past the room the widest keeps, far from the shorter words.
 */
export function CopyFaces({ said, children, chip, size }: CopyFacesProps) {
  const at = size ?? 'md';
  return (
    <span className="inline-grid">
      <span className={face({ size: at, shown: said === undefined })}>
        {children}
        {chip}
      </span>
      <span className={face({ size: at, shown: said === 'copied' })}>
        Copied
        {chip}
      </span>
      <span className={`${face({ size: at, shown: said === 'failed' })} text-danger`}>
        Couldn’t copy
        {chip}
      </span>
    </span>
  );
}

/**
 * What a Copy button says, to a screen reader: a live region beside the button, not in it, since a
 * button's content is its name.
 */
export function CopyStatus({ said }: { said: CopySaid | undefined }) {
  return (
    <span role="status" className="sr-only">
      {said === 'copied' ? 'Copied' : said === 'failed' ? 'Couldn’t copy' : ''}
    </span>
  );
}

/**
 * A button that copies something and says so itself: it reads "Copied" for two seconds, where the
 * reader is looking, so no toast says it again, or "Couldn’t copy" when it couldn't. A screen
 * reader hears the same from a live region beside it. It's as wide as the widest of the three
 * throughout, with its key's chip after what it says, where the key works now.
 */
export function CopyButton({
  children = 'Copy',
  keys,
  shortcut,
  onCopy,
  variant = 'ghost',
  size,
}: CopyButtonProps) {
  const [said, say] = useCopySaid();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        {...(keys === undefined ? {} : keyAria(keys, shortcut))}
        onClick={() => {
          // Called at once, and a throw is a failure as a rejection is.
          void new Promise((resolve) => resolve(onCopy())).then(
            (done) => {
              if (done !== false) say('copied');
            },
            (error: unknown) => {
              console.error("Lo couldn't copy:", error);
              say('failed');
            },
          );
        }}
      >
        <CopyFaces
          said={said}
          size={size}
          chip={keys === undefined ? undefined : <Key keys={keys} decorative />}
        >
          {children}
        </CopyFaces>
      </Button>
      <CopyStatus said={said} />
    </>
  );
}
