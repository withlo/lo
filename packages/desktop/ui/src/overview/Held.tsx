import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button } from '../Button.tsx';
import { holdHeight, type HeldHeight } from './hold.ts';

/** The overview's scrolling element that `element` is in, if it's in one. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('.lo-ov');
}

/**
 * A block of the overview whose contents change size by themselves, as a code block's do when its
 * code comes: it takes their height whenever that moves nothing on screen (`hold.ts`). Wholly on
 * screen with something under it, it keeps its height instead, and contents grown taller are cut
 * off above a row of its own, in the same room, with a button that shows them whole.
 */
export function Held({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const held = useRef<HeldHeight>(undefined);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const outer = box.current;
    const contents = inner.current;
    if (!outer || !contents || typeof ResizeObserver === 'undefined') return undefined;
    const holding = holdHeight(outer, contents, scrollerOf(outer), setCut);
    held.current = holding;
    return () => {
      holding.stop();
      held.current = undefined;
    };
  }, []);

  return (
    <div ref={box} className={cut ? 'lo-held is-cut' : 'lo-held'}>
      <div className="lo-held__clip">
        <div ref={inner}>{children}</div>
      </div>
      {cut && (
        <div className="lo-held__more">
          <Button size="sm" onClick={() => held.current?.release()}>
            Show the whole block
          </Button>
        </div>
      )}
    </div>
  );
}

/** How far from the screen a block is near, and how far it's far again, in screens. */
const NEAR = '100% 0px';
const FAR = '300% 0px';

/** Where a block is from the screen: near it, far from it, or not known yet. */
export type Nearness = 'near' | 'far' | undefined;

/**
 * Whether the element `ref` holds is near the screen: within a screen of it, and until it's three
 * screens away; or not known yet, until the first look. Without a way to tell, as in tests,
 * everything is near.
 */
export function useNearness(ref: RefObject<HTMLElement | null>): Nearness {
  const [nearness, setNearness] = useState<Nearness>(
    typeof IntersectionObserver === 'undefined' ? 'near' : undefined,
  );
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const root = scrollerOf(element);
    const comes = new IntersectionObserver(
      (entries) => {
        const near = entries.some((entry) => entry.isIntersecting);
        setNearness((was) => (near ? 'near' : (was ?? 'far')));
      },
      { root, rootMargin: NEAR },
    );
    const goes = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setNearness('far');
      },
      { root, rootMargin: FAR },
    );
    comes.observe(element);
    goes.observe(element);
    return () => {
      comes.disconnect();
      goes.disconnect();
    };
  }, [ref]);
  return nearness;
}

/** Whether the element `ref` holds is near the screen, as {@link useNearness} tells. */
export function useNear(ref: RefObject<HTMLElement | null>): boolean {
  return useNearness(ref) === 'near';
}
