import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, type ButtonProps } from './Button.tsx';

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
  /** What it says at rest: "Copy", or "Copy the log" where it isn't the only thing to copy. */
  children?: ReactNode;
  /**
   * Copies, as a rule through `useCopy`. The button reads "Copied" once this is done, unless it
   * answers `false`, which says nothing was copied. When it throws or rejects, the button reads
   * "Couldn’t copy".
   */
  onCopy: () => unknown;
}

type Said = 'copied' | 'failed';

/** One of the things the button says, all in one cell of its grid, so it's as wide as the widest. */
const face = (shown: boolean) =>
  shown ? 'col-start-1 row-start-1' : 'invisible col-start-1 row-start-1';

/**
 * A button that copies something and says so itself: it reads "Copied" for two seconds, where the
 * reader is looking, so no toast says it again, or "Couldn’t copy" when it couldn't. A screen
 * reader hears the same from a live region beside it. It's as wide as the widest of the three
 * throughout.
 */
export function CopyButton({
  children = 'Copy',
  onCopy,
  variant = 'ghost',
  size,
}: CopyButtonProps) {
  const [said, setSaid] = useState<Said | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (what: Said) => {
    setSaid(what);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(undefined), COPIED_MS);
  };
  return (
    <>
      <Button
        variant={variant}
        size={size}
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
        <span className="inline-grid">
          <span className={face(said === undefined)}>{children}</span>
          <span className={face(said === 'copied')}>Copied</span>
          <span className={`${face(said === 'failed')} text-danger`}>Couldn’t copy</span>
        </span>
      </Button>
      {/* Beside the button, not in it: a button's content is its name, not a live region. */}
      <span role="status" className="sr-only">
        {said === 'copied' ? 'Copied' : said === 'failed' ? 'Couldn’t copy' : ''}
      </span>
    </>
  );
}
