import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, type ButtonProps } from './Button.tsx';

/** How long a Copy button reads "Copied", in milliseconds. */
export const COPIED_MS = 2000;

export interface CopyButtonProps extends Pick<ButtonProps, 'variant' | 'size'> {
  /** What it says at rest: "Copy", or "Copy the log" where it isn't the only thing to copy. */
  children?: ReactNode;
  /**
   * Copies. The button reads "Copied" once this is done, unless it answers `false`, which says
   * nothing was copied.
   */
  onCopy: () => boolean | void | Promise<boolean | void>;
}

/**
 * A button that copies something and says so itself: it reads "Copied" for two seconds, where the
 * reader is looking, so no toast says it again. A screen reader hears the same from its place.
 */
export function CopyButton({
  children = 'Copy',
  onCopy,
  variant = 'ghost',
  size,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => {
        void Promise.resolve(onCopy()).then((done) => {
          if (done === false) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
    >
      <span className="inline-grid">
        <span className={copied ? 'invisible col-start-1 row-start-1' : 'col-start-1 row-start-1'}>
          {children}
        </span>
        <span
          role="status"
          className={copied ? 'col-start-1 row-start-1' : 'invisible col-start-1 row-start-1'}
        >
          {copied ? 'Copied' : ''}
        </span>
      </span>
    </Button>
  );
}
