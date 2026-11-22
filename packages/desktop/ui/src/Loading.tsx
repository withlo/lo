import { useEffect, useState } from 'react';

import { Button } from './Button.tsx';
import { Key } from './Key.tsx';
import { LogoMotion } from './LogoMotion.tsx';

/** How long a view waits with nothing shown before `Loading` appears: a quick load never shows it. */
export const LOADING_DELAY_MS = 300;

/** How long a wait runs before `Loading` says what's slow and offers to cancel. */
export const LOADING_SLOW_MS = 8000;

export interface LoadingProps {
  /** The wait, as a progress label: "Fetching diff…". */
  status: string;
  /**
   * What's slow, named once the wait has run eight seconds, in place of `status`: "Waiting for
   * GitHub…". Without it the status stays.
   */
  slow?: string | undefined;
  /** Gives the wait up. Offered as "Cancel" once the wait has run eight seconds. */
  onCancel?: (() => void) | undefined;
  /** The key that cancels, as the system shows each key of it. */
  cancelKeys?: readonly string[] | undefined;
}

type Stage = 'early' | 'waiting' | 'slow';

/**
 * How a view waits when it has nothing to draw yet: the mark melding, round and round, over one
 * line that names the wait. It fills the view it's in, and stays empty for its first 300 ms, so a
 * load that's quick shows nothing at all. After eight seconds its line says what's slow and it
 * offers "Cancel".
 *
 * It's the first of the three ways Lo waits. A view whose shape is known waits as a `Skeleton` laid
 * out as its content will be, and a control at work is `busy`.
 */
export function Loading({ status, slow, onCancel, cancelKeys }: LoadingProps) {
  const [stage, setStage] = useState<Stage>('early');
  useEffect(() => {
    const shown = setTimeout(() => setStage('waiting'), LOADING_DELAY_MS);
    const late = setTimeout(() => setStage('slow'), LOADING_SLOW_MS);
    return () => {
      clearTimeout(shown);
      clearTimeout(late);
    };
  }, []);

  const late = stage === 'slow';
  return (
    <div
      role="status"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-16 px-16"
    >
      {stage !== 'early' && (
        <>
          <LogoMotion play="meld" className="size-48 move-swap" decorative />
          <div className="flex flex-col items-center gap-12">
            <p
              key={late && slow !== undefined ? 'slow' : 'status'}
              className="m-0 min-h-1lh move-swap text-center text-fg-muted text-ui"
            >
              {late && slow !== undefined ? slow : status}
            </p>
            {/* Its room is kept from the start, so nothing shifts when it comes. */}
            {onCancel !== undefined && (
              <div className={late ? 'move-swap' : 'invisible'}>
                <Button size="sm" onClick={onCancel} tabIndex={late ? undefined : -1}>
                  Cancel
                  {cancelKeys && <Key keys={cancelKeys} decorative />}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
