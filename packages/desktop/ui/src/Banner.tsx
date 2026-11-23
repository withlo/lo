import { cva } from 'class-variance-authority';
import { createContext, useContext, type ReactNode } from 'react';

import { Button } from './Button.tsx';
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
 * How many other banners wait behind the one shown, and the way to the next of them. A tab shows
 * one banner at a time, and gives this to the one it shows, which offers "+1".
 */
export interface BannerMore {
  readonly count: number;
  readonly next: () => void;
}

const More = createContext<BannerMore | undefined>(undefined);

/** Gives the banner inside it the others that wait behind it. */
export const BannerMoreProvider = More.Provider;

const Drawn = createContext<((props: BannerProps) => void) | undefined>(undefined);

/**
 * Hears what the banner inside it draws, as it draws it, so the tab can draw the same banner while
 * it leaves, once its owner has none to draw.
 */
export const BannerDrawn = Drawn.Provider;

/**
 * One line under the PR header about a change to this pull request: what changed, the one thing to
 * do about it, and Dismiss. A tab shows one at a time, the most urgent, with "+1" for the rest, and
 * opens and closes the row it's in with the Open move. Offers, set-up and standing states aren't
 * banners: they go on the control they belong to. A `danger` banner is an alert; the others are
 * announced politely.
 */
export function Banner(props: BannerProps) {
  const { tone, title, detail, action, onDismiss } = props;
  const more = useContext(More);
  useContext(Drawn)?.(props);
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={banner({ tone })}>
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
              onClick={more.next}
            >
              <span className="lo-num">+{more.count}</span>
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" icon aria-label="Dismiss" onClick={onDismiss}>
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
