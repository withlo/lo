import { useEffect, useId, useRef, useState } from 'react';

import { logoFrame, logoLoops, logoSeconds, type LogoFrame, type LogoPlay } from './logoFrames.ts';
import { LOGO } from './logoKeys.ts';
import { useMotionReduced } from './motion.ts';

export type { LogoPlay } from './logoFrames.ts';

export interface LogoMotionProps {
  /**
   * Which of the mark's animations plays. `unmeld`: the ball leaves the corner, on the first screen
   * of the welcome. `meld`: the ball melds in and leaves again, round and round, while a view has
   * nothing to draw (`Loading` shows it). `kiss`: the ball dips to the corner and comes back, when
   * something is done.
   */
  play: LogoPlay;
  /** Its size: `size-mark-lg` for the unmeld, `size-48` for the loop, `size-40` for the kiss. */
  className?: string | undefined;
  /** It has played once and rests as the mark. Never called for the loop. */
  onDone?: (() => void) | undefined;
  /** Beside words that already say what it stands for, so a screen reader passes over it. */
  decorative?: boolean | undefined;
  /**
   * When it began to play, as `Date.now()` gives it, where that was before this was drawn: it's
   * drawn as far in as it would be by now. `Loading` gives it, so the loop of a wait drawn in one
   * view after another carries on and doesn't start over.
   */
  since?: number | undefined;
}

const { l, socket, rest, goo } = LOGO;

/** Blurs the shapes into one, then cuts the blur off hard: what makes them run like a liquid. */
const THRESHOLD = `1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${goo.slope} ${goo.offset}`;

const turn = (x: number, y: number) => `rotate(-45 ${x} ${y})`;

function draw(ball: SVGEllipseElement | null, pool: SVGPathElement | null, frame: LogoFrame) {
  pool?.setAttribute('d', frame.pool);
  if (!ball) return;
  ball.setAttribute('cx', String(frame.ball.x));
  ball.setAttribute('cy', String(frame.ball.y));
  ball.setAttribute('rx', String(frame.ball.rx));
  ball.setAttribute('ry', String(frame.ball.ry));
  ball.setAttribute('transform', turn(frame.ball.x, frame.ball.y));
}

/**
 * Lo's mark, moving: the only thing in Lo that takes its time. It's drawn from the brand's own
 * keys, in the mark's color, so it's chalk on dark and ink on light with nothing to set. Each
 * animation plays once and ends on the mark at rest; the meld loop repeats while it's shown.
 *
 * With Reduce Motion on it's the mark at rest, and `onDone` is called at once. It never holds
 * anything up: what it celebrates has already happened, and what it waits for shows when it comes.
 * To play the same animation again, give it a new `key`.
 */
export function LogoMotion({
  play,
  className,
  onDone,
  decorative = false,
  since,
}: LogoMotionProps) {
  const reduced = useMotionReduced();
  const [played, setPlayed] = useState<LogoPlay | undefined>(undefined);
  const still = reduced || played === play;
  const filter = useId();

  const pool = useRef<SVGPathElement>(null);
  const ball = useRef<SVGEllipseElement>(null);
  const softPool = useRef<SVGPathElement>(null);
  const softBall = useRef<SVGEllipseElement>(null);
  const neck = useRef<SVGPathElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  // Told once for each animation, however it came to rest.
  const told = useRef<LogoPlay | undefined>(undefined);
  const finish = useRef((which: LogoPlay) => {
    if (told.current === which) return;
    told.current = which;
    done.current?.();
  });

  useEffect(() => {
    if (reduced && !logoLoops(play)) finish.current(play);
  }, [play, reduced]);

  useEffect(() => {
    if (still || typeof requestAnimationFrame !== 'function') return undefined;
    const length = logoSeconds(play);
    const loops = logoLoops(play);
    let started: number | undefined;
    let frame = requestAnimationFrame(function step(now) {
      started ??= now - (since === undefined ? 0 : Math.max(0, Date.now() - since));
      const seconds = (now - started) / 1000;
      const at = logoFrame(play, seconds);
      draw(ball.current, pool.current, at);
      draw(softBall.current, softPool.current, at);
      neck.current?.setAttribute('d', at.neck);
      if (!loops && seconds >= length) {
        setPlayed(play);
        finish.current(play);
        return;
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [play, still, since]);

  const name = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Lo' };
  const size = className === undefined ? 'overflow-visible' : `overflow-visible ${className}`;
  if (still) {
    return (
      <svg className={size} viewBox="12 12 76 76" {...name}>
        <g className="fill-mark">
          <path d={l} />
          <circle cx={rest.x} cy={rest.y} r={rest.radius} />
        </g>
      </svg>
    );
  }
  const first = logoFrame(play, since === undefined ? 0 : Math.max(0, Date.now() - since) / 1000);
  const shapes = (poolRef: typeof pool, ballRef: typeof ball) => (
    <>
      <path d={l} />
      <path ref={poolRef} d={first.pool} />
      <ellipse
        ref={ballRef}
        cx={first.ball.x}
        cy={first.ball.y}
        rx={first.ball.rx}
        ry={first.ball.ry}
        transform={turn(first.ball.x, first.ball.y)}
      />
    </>
  );
  return (
    <svg className={size} viewBox="12 12 76 76" {...name}>
      <defs>
        <filter
          id={filter}
          x="-20"
          y="-20"
          width="140"
          height="140"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation={goo.blur} />
          <feColorMatrix values={THRESHOLD} />
        </filter>
      </defs>
      <g className="fill-mark">
        <g filter={`url(#${filter})`}>
          {shapes(softPool, softBall)}
          <g transform={turn(socket.x, socket.y)}>
            <path ref={neck} d={first.neck} />
          </g>
        </g>
        {shapes(pool, ball)}
      </g>
    </svg>
  );
}
