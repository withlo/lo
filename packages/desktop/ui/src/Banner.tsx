import { cva } from 'class-variance-authority';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button } from './Button.tsx';
import { handOffFocus, type FocusTarget } from './focus.ts';
import { Key } from './Key.tsx';

const banner = cva('flex min-w-0 items-center gap-12 py-6 ps-16 pe-12 text-fg text-ui', {
  variants: {
    tone: {
      info: 'banner-info',
      warn: 'banner-warn',
      danger: 'banner-danger',
    },
  },
});

const icon = cva('flex-none', {
  variants: {
    tone: { info: 'text-info', warn: 'text-warning', danger: 'text-danger' },
  },
});

/** What a banner offers to do. Its label starts with a verb. */
export interface BannerAction {
  label: string;
  onClick: () => void;
  /**
   * It's being done: the button is busy and says `working`, and pressing it does nothing until it's
   * done. It keeps focus, its fill and its width. Pass `false` while it rests, for an action that
   * can be busy, as to a `Button`.
   */
  busy?: boolean | undefined;
  /** What the button says while busy, the verb of its label: "Trusting". */
  working?: string | undefined;
  /**
   * The widest thing it says while busy, when `working` changes as the work goes on: the button
   * holds that room from before its press, as a `Button` with one does.
   */
  widest?: string | undefined;
  /** The key that does the same from anywhere in the tab, as the system shows it: `['m']`. */
  keys?: readonly string[] | undefined;
}

export interface BannerProps {
  tone: 'info' | 'warn' | 'danger';
  /** What changed, as a fact: "ravi-k pushed r5". */
  title: ReactNode;
  /** One more fact, where the title can't hold it, on the same line. */
  detail?: ReactNode;
  /** The one thing to do about it. */
  action?: BannerAction | undefined;
  /** Puts it away for good, for news the reader has seen. */
  onDismiss?: (() => void) | undefined;
}

/**
 * Where a tab shows the banner it shows: one at a time, in a row under the PR header, with "+1" for
 * the others.
 */
export interface BannerPlace {
  /**
   * How many other banners wait behind this one, and the way to the next of them, which "+1" takes.
   * None while it's the only one.
   */
  readonly more?: { readonly count: number; readonly next: () => void } | undefined;
  /** The row the banners show in, which stays as one gives way to the next. */
  readonly row: RefObject<HTMLElement | null>;
  /** Where focus goes once the last banner is dismissed: the view under the row. */
  readonly view?: FocusTarget | undefined;
}

const Place = createContext<BannerPlace | undefined>(undefined);

/** Tells the banner inside it where it's shown. */
export const BannerPlaceProvider = Place.Provider;

const Drawn = createContext<((props: BannerProps) => void) | undefined>(undefined);

/**
 * Hears what the banner inside it draws, once it's drawn, so the tab can draw the same banner while
 * it leaves, once its owner has none to draw.
 */
export const BannerDrawn = Drawn.Provider;

/** Which of a banner's buttons each is, for focus to go to the same one on the next banner. */
type Control = 'action' | 'more' | 'dismiss';

/** The buttons of kind `kind` in `row`, the banner taking a leaving one's place among them. */
function controls(row: HTMLElement | null, kind: Control): HTMLElement[] {
  return [...(row?.querySelectorAll<HTMLElement>(`[data-lo-banner="${kind}"]`) ?? [])];
}

/**
 * One line under the PR header about a change to this pull request: what changed, the one thing to
 * do about it, and Dismiss. A tab shows one at a time, the most urgent, with "+1" for the rest, and
 * opens and closes the row it's in with the Open move. Offers, set-up and standing states aren't
 * banners: they go on the control they belong to. A `danger` banner is an alert; the others are
 * announced politely. In a tab's row (`BannerPlaceProvider`), the row says each one as it comes,
 * once, so the banner itself is still, and a title that changes in place isn't said again.
 *
 * Focus stays in the row as one banner gives way to the next: "+1" hands it to the next banner's
 * "+1", or its action where it has none, and Dismiss to the next banner's Dismiss, or its action or
 * "+1". A banner that leaves while it holds focus for any other reason, as its own action takes it
 * away, or a more urgent one takes its place, hands it to the next banner's action, else its "+1",
 * else its Dismiss. Either way, once it was the last, focus goes to the view under the row.
 */
export function Banner(props: BannerProps) {
  const { tone, title, detail, action, onDismiss } = props;
  const place = useContext(Place);
  const more = place?.more;
  const drawn = useContext(Drawn);
  useLayoutEffect(() => drawn?.(props));
  const self = useRef<HTMLDivElement>(null);
  // Leaving while it holds focus, whatever took it away, it hands focus to the banner that takes its
  // place. A press of "+1" or Dismiss has handed it on already, to the same button there.
  const leaving = useRef(place);
  leaving.current = place;
  useLayoutEffect(
    () => () => {
      const row = leaving.current?.row.current ?? null;
      const view = leaving.current?.view;
      handOffFocus([self.current], () => [
        ...controls(row, 'action'),
        ...controls(row, 'more'),
        ...controls(row, 'dismiss'),
        view,
      ]);
    },
    [],
  );
  /** Hands focus on from `kind`, pressed, to the banner that takes this one's place. */
  const handOff = (kind: Control) => {
    const row = place?.row.current ?? null;
    handOffFocus([self.current], () =>
      kind === 'more'
        ? [...controls(row, 'more'), ...controls(row, 'action')]
        : [
            ...controls(row, kind),
            ...controls(row, 'action'),
            ...controls(row, 'more'),
            place?.view,
          ],
    );
  };
  return (
    <div
      ref={self}
      role={tone === 'danger' ? 'alert' : 'status'}
      // The row says it as it comes, once.
      aria-live={place ? 'off' : undefined}
      className={banner({ tone })}
    >
      <BannerIcon tone={tone} />
      <p className="m-0 min-w-0 flex-1">
        <strong className="font-semibold">{title}</strong>
        {detail !== undefined && <span className="text-fg-muted"> {detail}</span>}
      </p>
      {(action || onDismiss || more) && (
        <div className="flex flex-none items-center gap-6">
          {action && (
            <Button
              size="sm"
              busy={action.busy}
              working={action.working}
              widest={action.widest}
              onClick={action.onClick}
              data-lo-banner="action"
            >
              {action.label}
              {action.keys && <Key keys={action.keys} decorative />}
            </Button>
          )}
          {more && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Next, ${more.count} more`}
              onClick={() => {
                more.next();
                handOff('more');
              }}
              data-lo-banner="more"
            >
              <span className="lo-num">+{more.count}</span>
            </Button>
          )}
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label="Dismiss"
              hint="Dismiss"
              onClick={() => {
                onDismiss();
                handOff('dismiss');
              }}
              data-lo-banner="dismiss"
            >
              <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BannerIcon({ tone }: { tone: BannerProps['tone'] }) {
  return (
    <svg className={`lo-i ${icon({ tone })}`} viewBox="0 0 16 16" aria-hidden="true">
      {tone === 'info' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4M8 4.75v.01" />
        </>
      ) : (
        <>
          <path d="M8 2.25 14.25 13.25H1.75Z" />
          <path d="M8 6.5v3M8 11.25v.01" />
        </>
      )}
    </svg>
  );
}
