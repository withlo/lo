// What a pull request's tab says of itself, each thing in its one place: its banner, one at a time,
// for a change to the pull request; why it can't show the pull request, in place of its view, or
// the account to choose; how it stands with GitHub, in the header chip's details; and its local
// copy and its rate limit, as status bar items, with their details. `banners.ts` has the words.

import {
  Banner,
  BannerDrawn,
  BannerMoreProvider,
  Button,
  Collapse,
  ContextMenu,
  CopyButton,
  Countdown,
  EmptyState,
  Problem,
  StatusActions,
  StatusItem,
  StatusLine,
  Swap,
  useCopy,
  useDetails,
  type BannerProps,
  type ContextMenuAnchor,
  type HeaderConnection,
} from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { useViews, type View } from '../../../window/slots.tsx';
import { contract as settings } from '../../settings/contract.ts';
import { viewIds, type Connection, type LocalState, type PullView } from '../contract.ts';
import {
  accountChoice,
  ago,
  bannersFor,
  connectionNote,
  failureOf,
  localNote,
  systemClock,
  type BannerDo,
  type BannerSpec,
} from './banners.ts';
import { main } from './main.ts';
import {
  banners as bannerSlot,
  tabState,
  useTabs,
  useTabState,
  type BannerSwitch,
  type PullTab,
} from './shared.ts';

/** Where a tab's details are put in the page: inside `.lo-app`. */
function container(): HTMLElement | null {
  return document.getElementById('root');
}

/** Does what one of the tab's buttons says, for tab `id`. */
export function run(id: string, action: BannerDo): void {
  const done = (() => {
    switch (action.kind) {
      case 'retry':
        return main().retry({ id });
      case 'reload':
        return main().reload({ id });
      case 'choose':
        return main().choose({ id, login: action.login });
      case 'signIn':
        registry().run('accounts.addAccount', NO_TARGET);
        return Promise.resolve();
      case 'close':
        return main().close({ id });
      case 'link':
        return main().openExternal({ url: action.url });
      case 'clearCache':
        return client(settings)
          .clearCache()
          .then(() => main().retry({ id }));
      case 'layer':
        return main()
          .layer({ id, number: action.number })
          .then(() => undefined);
      default:
        action satisfies never;
        return Promise.resolve();
    }
  })();
  done.catch((error: unknown) => console.error("Lo couldn't do what the tab offered:", error));
}

/** A reason, and the wait before Lo tries again by itself after it, counting down. */
function reasonOf(detail: string | undefined, retryAt: number | undefined): ReactNode {
  if (retryAt === undefined) return detail;
  return (
    <>
      {detail === undefined ? '' : `${detail} `}Retrying <Countdown at={retryAt} />.
    </>
  );
}

/** A reason, then what it says to run, each as code with Copy: how to install Git. */
function Commands({ reason, commands }: { reason: ReactNode; commands: readonly string[] }) {
  const copy = useCopy();
  return (
    <>
      {reason}
      {commands.map((command) => (
        <span key={command} className="ms-8 inline-flex items-center gap-4 align-middle">
          <code className="break-all text-fg code-small select-text">{command}</code>
          <CopyButton size="sm" variant="ghost" onCopy={() => copy(command)} />
        </span>
      ))}
    </>
  );
}

/** The pull request a tab's view opened on, when the view on screen is another layer of its stack. */
function useOwn(tab: PullTab): number | undefined {
  const held = useTabs().tabs.find((each) => viewIds([each]).includes(tab.id));
  return held?.kind === 'pull' && held.number !== tab.number ? held.number : undefined;
}

/**
 * What takes the place of a tab's view while it can't show its pull request: why, with what to do
 * about it, or the account to open it as. Nothing while it can.
 */
export function TabFailed({ tab, view }: { tab: PullTab; view: PullView | undefined }) {
  const own = useOwn(tab);
  const failure = failureOf(view, tab, own);
  const choice = accountChoice(view, tab);
  if (failure) {
    const [first, ...rest] = failure.actions;
    const act = (each: { label: string; do: BannerDo }) => ({
      label: each.label,
      onClick: () => run(tab.id, each.do),
    });
    return (
      <div className="absolute inset-0 bg-bg" data-lo-failed>
        <Problem
          layout="view"
          title={failure.title}
          reason={reasonOf(failure.detail, failure.retryAt)}
          action={first && act(first)}
          others={rest.map(act)}
          details={failure.details}
        />
      </div>
    );
  }
  if (choice) {
    return (
      <div className="absolute inset-0 bg-bg" data-lo-failed>
        <EmptyState title={choice.title} line={choice.line}>
          <Accounts
            logins={choice.logins}
            onChoose={(login) => run(tab.id, { kind: 'choose', login })}
          />
        </EmptyState>
      </div>
    );
  }
  return null;
}

/**
 * The accounts a tab can open its pull request as: a button for each of two, the first the main
 * one, or past two, "Choose account…", whose menu lists them.
 */
function Accounts({
  logins,
  onChoose,
}: {
  logins: readonly string[];
  onChoose: (login: string) => void;
}) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | undefined>(undefined);
  const [opener, setOpener] = useState<HTMLElement | undefined>(undefined);
  // Opened from the keyboard, the menu highlights its first account, so `⏎` opens it at once.
  const [fromKeys, setFromKeys] = useState(false);
  if (logins.length <= 2) {
    return (
      <div className="flex flex-wrap justify-center gap-8">
        {logins.map((login, index) => (
          <Button
            key={login}
            variant={index === 0 ? 'primary' : 'secondary'}
            onClick={() => onChoose(login)}
          >
            Open as {login}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <Button
        variant="primary"
        aria-haspopup="menu"
        onClick={(event) => {
          const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
          setOpener(event.currentTarget);
          setFromKeys(event.detail === 0);
          setAnchor({ x: left, y: top, width, height });
        }}
      >
        Choose account…
      </Button>
      <ContextMenu
        open={anchor !== undefined}
        onOpenChange={(open) => {
          if (!open) setAnchor(undefined);
        }}
        label="Accounts"
        anchor={anchor}
        sections={[logins.map((login) => ({ id: login, label: login }))]}
        finalFocus={opener}
        highlightFirst={fromKeys}
        onClosed={(chosen) => {
          if (chosen !== undefined) onChoose(chosen);
        }}
        container={container()}
      />
    </div>
  );
}

/** Whether a tab can't show its pull request now, so its failure takes the view's place. */
export function blocked(view: PullView | undefined): boolean {
  return view?.problem !== null && view?.problem !== undefined;
}

/** The time now, ticking each minute while `ticking`, for "Checked 5 min ago". */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? now : Date.now();
}

/**
 * The header's chip for how tab `id` stands with GitHub, when it isn't as usual: a word or two,
 * whose details say why, when the tab last heard from GitHub, and the one thing to do about it.
 */
export function useHeaderConnection(
  id: string,
  connection: Connection | undefined,
): HeaderConnection | undefined {
  const now = useNow(connection?.kind === 'offline');
  const note = connectionNote(connection, systemClock(now));
  if (!note) return undefined;
  const { action } = note;
  return {
    tone: note.tone,
    label: note.label,
    container: container(),
    details: (
      <>
        <StatusLine>
          {reasonOf(note.line, note.retryAt)}
          {note.checked !== undefined && (
            <span className="block">Checked {ago(note.checked, now)}</span>
          )}
        </StatusLine>
        {(action || note.details !== undefined) && (
          <ConnectionActions
            details={note.details}
            action={action && { label: action.label, onClick: () => run(id, action.do) }}
          />
        )}
      </>
    ),
  };
}

/** The chip's details' one button, and what GitHub or the network said, behind Details. */
function ConnectionActions({
  action,
  details,
}: {
  action: { label: string; onClick: () => void } | undefined;
  details: string | undefined;
}) {
  const { more, shown } = useDetails(details, 'pt-2');
  return (
    <>
      <StatusActions>
        {action && (
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        {more}
      </StatusActions>
      {shown}
    </>
  );
}

/**
 * The local copy's status bar item: what it's doing, or that it's there, and with what's behind it
 * in its details: the commit it's at, or why it can't be fetched and what to do about it.
 */
export function LocalItem({
  tab,
  local,
  view,
}: {
  tab: PullTab;
  local: LocalState | undefined;
  view: PullView | undefined;
}): ReactNode {
  const note = localNote(local, view, tab);
  if (!note) return null;
  const { problem } = note;
  const details =
    problem !== undefined ? (
      <Problem
        title={problem.title}
        reason={
          problem.commands === undefined ? (
            reasonOf(problem.detail, problem.retryAt)
          ) : (
            <Commands
              reason={reasonOf(problem.detail, problem.retryAt)}
              commands={problem.commands}
            />
          )
        }
        action={
          problem.actions[0] && {
            label: problem.actions[0].label,
            onClick: () => {
              const first = problem.actions[0];
              if (first) run(tab.id, first.do);
            },
          }
        }
        details={problem.details}
      />
    ) : note.at !== undefined ? (
      <StatusLine>
        At <code className="text-fg code-small">{note.at}</code>
      </StatusLine>
    ) : undefined;
  return (
    <StatusItem ball={note.ball} details={details} label={note.label} container={container()}>
      {note.label}
    </StatusItem>
  );
}

/** The status bar's item for a rate limit that's running low, with how much of it is left. */
export function LimitItem({ connection }: { connection: Connection | undefined }): ReactNode {
  if (connection?.kind !== 'limitLow') return null;
  return (
    <StatusItem
      ball="warn"
      label="Rate limit low"
      container={container()}
      details={
        <StatusLine>{connection.remaining.toLocaleString('en-US')} requests left</StatusLine>
      }
    >
      Rate limit low
    </StatusItem>
  );
}

/** The newer push each tab's reader dismissed, so its banner stays away until a newer one. */
const dismissedNewer = tabState<string | null>(() => null);

/** Which banner each tab shows, of those it has, by its id: the most urgent, until "+1" moves on. */
const front = tabState<string | null>(() => null);

/** Another feature's view in the tab's banner slot. */
type BannerView = View<{ tab: PullTab }> & BannerSwitch;

/** One of the tab's banners, its own or another feature's. */
type Entry =
  | { readonly id: string; readonly own: BannerSpec }
  | { readonly id: string; readonly view: BannerView };

/**
 * Another feature's banner, as it draws it while it has one, and as it last drew it once it has
 * none, while the row it was in closes: the row leaves with what it said, not empty.
 */
function Held({
  entry,
  tab,
  drawn,
}: {
  entry: { readonly id: string; readonly view: BannerView };
  tab: PullTab;
  drawn: Map<string, BannerProps>;
}) {
  const { view } = entry;
  const hear = useCallback(
    (props: BannerProps) => {
      drawn.set(entry.id, props);
    },
    [drawn, entry.id],
  );
  if (view.shows(tab)) {
    return (
      <BannerDrawn value={hear}>
        <view.render tab={tab} />
      </BannerDrawn>
    );
  }
  const last = drawn.get(entry.id);
  return last ? <Banner {...last} /> : null;
}

/**
 * The tab's banner: one at a time, its own first, then other features' in their order, with "+1"
 * for the rest, which moves to the next. The row opens as the first comes and closes as the last
 * goes, with the Open move, and one gives way to the next in place.
 */
export function Banners({ tab, view }: { tab: PullTab; view: PullView | undefined }) {
  const dismissed = useTabState(dismissedNewer, tab.id);
  const chosen = useTabState(front, tab.id);
  const own = bannersFor(view, dismissed);
  const views: readonly BannerView[] = useViews(bannerSlot);
  const drawn = useRef(new Map<string, BannerProps>()).current;
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = views.map((each) => each.subscribe(tab, listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [views, tab],
  );
  // The ids of the views that show a banner for the tab now, as one string, so it compares.
  const showing = useSyncExternalStore(subscribe, () =>
    views
      .filter((each) => each.shows(tab))
      .map((each) => each.id)
      .join('\n'),
  );
  const shown = new Set(showing.split('\n'));
  const entries: Entry[] = [
    ...own.map((spec) => ({ id: spec.id, own: spec })),
    ...views.filter((each) => shown.has(each.id)).map((each) => ({ id: each.id, view: each })),
  ];
  const at = Math.max(
    0,
    entries.findIndex((entry) => entry.id === chosen),
  );
  const entry = entries[at];
  const more =
    entries.length > 1
      ? {
          count: entries.length - 1,
          next: () => front.set(tab.id, entries[(at + 1) % entries.length]?.id ?? null),
        }
      : undefined;
  const body =
    entry === undefined ? null : 'own' in entry ? (
      <OwnBanner tab={tab} spec={entry.own} newer={view?.newer ?? null} />
    ) : (
      <Held entry={entry} tab={tab} drawn={drawn} />
    );
  return (
    <div className="flex flex-none flex-col" data-lo-banners>
      <Collapse open={entry !== undefined}>
        <BannerMoreProvider value={more}>
          <Swap id={entry?.id ?? 'none'}>{body}</Swap>
        </BannerMoreProvider>
      </Collapse>
    </div>
  );
}

/**
 * One of the tab's own banners: a newer push, which it can show, or put away until a newer one.
 * `newer` is the push it's about.
 */
function OwnBanner({ tab, spec, newer }: { tab: PullTab; spec: BannerSpec; newer: string | null }) {
  const [first] = spec.actions;
  return (
    <Banner
      tone={spec.tone}
      title={spec.title}
      detail={spec.detail}
      action={first && { label: first.label, onClick: () => run(tab.id, first.do) }}
      onDismiss={() => dismissedNewer.set(tab.id, newer)}
    />
  );
}
