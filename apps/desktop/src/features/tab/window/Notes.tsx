// What a pull request's tab says of itself, each thing in its one place: its banner, one at a time,
// for a change to the pull request; why it can't show the pull request, in place of its view, or
// the account to choose; how it stands with GitHub, in the header chip's details; and its local
// copy and its rate limit, as status bar items, with their details. `banners.ts` has the words.

import {
  ago,
  Banner,
  BannerDrawn,
  BannerPlaceProvider,
  Button,
  Collapse,
  ContextMenu,
  CopyFaces,
  CopyStatus,
  Countdown,
  EmptyState,
  Problem,
  StatusActions,
  StatusCommand,
  StatusFacts,
  StatusItem,
  StatusLine,
  Swap,
  handOffFocus,
  useCopySaid,
  useDetails,
  WholePath,
  type BannerPlace,
  type BannerProps,
  type EmptyAction,
  type HeaderConnection,
} from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { focusMiddle, registry, systemOf } from '../../../window/commands/registry.ts';
import { chipLabel, explain } from '../../../window/explain.ts';
import { client } from '../../../window/ipc.ts';
import { useViews, type View } from '../../../window/slots.tsx';
import { useRevisions } from '../../revisions/window/shared.ts';
import { contract as settings } from '../../settings/contract.ts';
import { viewIds, type Connection, type LocalState, type PullView } from '../contract.ts';
import {
  accountChoice,
  bannersFor,
  blocked,
  connectionNote,
  failureOf,
  localNote,
  systemClock,
  type BannerDo,
  type BannerSpec,
} from './banners.ts';
import { answerLocalCopies } from './localCopy.ts';
import { main } from './main.ts';
import {
  banners as bannerSlot,
  pullOf,
  tabState,
  useTabs,
  useTabState,
  type BannerSaid,
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

/** The pull request a tab's view opened on, when the view on screen is another layer of its stack. */
function useOwn(tab: PullTab): number | undefined {
  const held = useTabs().tabs.find((each) => viewIds([each]).includes(tab.id));
  return held?.kind === 'pull' && held.number !== tab.number ? held.number : undefined;
}

/**
 * What takes the place of a tab's view while it can't show its pull request: why, with what to do
 * about it, or the account to open it as. Nothing while it can, nor for a read that failed after
 * the view was drawn, which stays, with the header's chip saying why.
 */
export function TabFailed({ tab, view }: { tab: PullTab; view: PullView | undefined }) {
  const own = useOwn(tab);
  const failure = blocked(view) ? failureOf(view, tab, own) : undefined;
  const choice = accountChoice(view, tab);
  if (failure) {
    const [first, ...rest] = failure.actions;
    const act = (each: { label: string; do: BannerDo }) => ({
      label: each.label,
      onClick: () => run(tab.id, each.do),
    });
    return (
      <div className="absolute inset-0 sheet" data-lo-failed>
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
  if (choice)
    return <Accounts tab={tab} title={choice.title} line={choice.line} logins={choice.logins} />;
  return null;
}

/** The command that opens a tab's pull request as an account, or the menu of them. */
const CHOOSE = 'tab.chooseAccount';

/** Which tabs have their menu of accounts open, as Choose account… opens it. */
const choosing = tabState<boolean>(() => false);

/** Why tab `tab` can't be opened as an account now: `true` where it can. */
export function choosable(tab: PullTab): true | string {
  return accountChoice(pullOf(tab.id), tab) ? true : 'No account to choose';
}

/**
 * Opens tab `tab`'s pull request as `row`, the login of an account that can see it, which Lo
 * remembers for the repo's owner; or, for anything else, as a row of another list a key or the
 * palette had, opens the menu of the accounts it can be opened as.
 */
export function chooseAccount(tab: PullTab, row: string | null): void {
  const choice = accountChoice(pullOf(tab.id), tab);
  if (!choice) return;
  if (row !== null && choice.logins.includes(row)) run(tab.id, { kind: 'choose', login: row });
  else choosing.set(tab.id, true);
}

/**
 * The accounts a tab can open its pull request as: "Open as" for each of two, the first the main
 * button, or past two, "Choose account…", whose menu lists them. Each runs the command that takes
 * an account, which the palette and the File menu run too, without one, to open the menu.
 */
function Accounts({
  tab,
  title,
  line,
  logins,
}: {
  tab: PullTab;
  title: string;
  line: string;
  logins: readonly string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const open = useTabState(choosing, tab.id);
  // Opened by a click, the menu highlights nothing; from the keyboard, its first account, so `⏎`
  // opens it at once.
  const pointed = useRef(false);
  const [first, second, third] = logins;
  const as = (login: string): EmptyAction => ({
    command: CHOOSE,
    target: { kind: 'row', row: login },
    label: `Open as ${login}`,
  });
  const actions: readonly [] | readonly [EmptyAction] | readonly [EmptyAction, EmptyAction] =
    first === undefined || third !== undefined
      ? [CHOOSE]
      : second === undefined
        ? [as(first)]
        : [as(first), as(second)];
  // The menu opens under the main button, and gives focus back to it as it closes.
  const opener = useRef<HTMLElement | undefined>(undefined);
  if (open) opener.current = box.current?.querySelector('button') ?? undefined;
  const rect = open ? opener.current?.getBoundingClientRect() : undefined;
  return (
    <div
      ref={box}
      className="absolute inset-0 sheet"
      data-lo-failed
      onPointerDownCapture={() => {
        pointed.current = true;
      }}
      onKeyDownCapture={() => {
        pointed.current = false;
      }}
    >
      <EmptyState icon="users-round" title={title} line={line} actions={actions} />
      <ContextMenu
        open={rect !== undefined}
        onOpenChange={(next) => {
          if (!next) choosing.set(tab.id, false);
        }}
        label="Accounts"
        anchor={rect && { x: rect.left, y: rect.top, width: rect.width, height: rect.height }}
        sections={[logins.map((login) => ({ id: login, label: login }))]}
        finalFocus={opener.current}
        highlightFirst={!pointed.current}
        onClosed={(chosen) => {
          choosing.set(tab.id, false);
          if (chosen !== undefined) run(tab.id, { kind: 'choose', login: chosen });
        }}
        container={container()}
      />
    </div>
  );
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
 * The header's chip for a tab whose read failed after its view was drawn, which stays: what
 * `chipLabel` calls its cause, else "GitHub error".
 */
function readFailed(view: PullView | undefined): string {
  const problem = view?.problem;
  return problem?.kind === 'failed' ? chipLabel(problem.cause, 'GitHub error') : 'GitHub error';
}

/**
 * The header's chip for how tab `tab` stands with GitHub, when it isn't as usual: a word or two,
 * whose details say why, when GitHub last confirmed what's on screen, and the one thing to do
 * about it. A read that failed after the view was drawn says so here too, as the view stays: amber
 * while it counts down to trying again, red once it doesn't. There's none while the tab's view is
 * its problem, which says why.
 */
export function useHeaderConnection(
  tab: PullTab,
  view: PullView | undefined,
): HeaderConnection | undefined {
  const connection = view?.connection;
  // "Checked" goes under the line while there's a view it's about.
  const checked = view?.shown === null ? undefined : view?.checked;
  const now = useNow(checked !== undefined);
  // While the tab's view is its problem, the problem says why, once.
  if (blocked(view)) return undefined;
  const note = connectionNote(connection, systemClock(now));
  const failed = note ? undefined : failureOf(view, tab);
  const said = failed
    ? {
        kind: 'failed' as const,
        tone: failed.retryAt === undefined ? ('danger' as const) : ('warn' as const),
        label: readFailed(view),
        line: failed.detail,
        retryAt: failed.retryAt,
        details: failed.details,
        action: failed.actions[0],
      }
    : note;
  if (!said) return undefined;
  const { action } = said;
  return {
    kind: said.kind,
    tone: said.tone,
    label: said.label,
    container: container(),
    details: (
      <>
        <StatusLine>
          {reasonOf(said.line, said.retryAt)}
          {checked !== undefined && <span className="block">Checked {ago(checked, now)}</span>}
        </StatusLine>
        {(action || said.details !== undefined) && (
          <ConnectionActions
            details={said.details}
            action={action && { label: action.label, onClick: () => run(tab.id, action.do) }}
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
      <StatusActions flush={!action}>
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
 * in its details: the commit it's at and where it is, with Show in Finder and Copy path, what it
 * waits for, or why it can't be fetched and what to do about it.
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
        layout="details"
        // Amber while it waits, as its ball is: red only once it failed.
        tone={note.ball === 'failed' ? 'danger' : 'warn'}
        title={problem.title}
        reason={reasonOf(problem.detail, problem.retryAt)}
        commands={problem.commands}
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
      <Where id={tab.id} commit={note.at} folder={note.folder} />
    ) : (
      <Fetching line={note.line} said={note.said} />
    );
  return (
    <StatusItem ball={note.ball} details={details} label={note.label} container={container()}>
      {note.label}
    </StatusItem>
  );
}

/**
 * Where a local copy that's there is, as two facts: the commit it's at, and its folder, `~` for the
 * home folder, which Show in Finder shows and Copy path copies whole, as their commands do from the
 * palette. Copy path reads "Copied" for a copy made either way while it's drawn.
 */
function Where({ id, commit, folder }: { id: string; commit: string; folder: string }) {
  const [said, say] = useCopySaid();
  useEffect(() => answerLocalCopies(id, say), [id, say]);
  return (
    <>
      <StatusFacts
        items={[
          { label: 'Commit', value: <code className="text-fg code-small">{commit}</code> },
          { label: 'Folder', value: <WholePath path={folder} className="text-fg code-small" /> },
        ]}
      />
      <StatusActions>
        <StatusCommand command="tab.showLocalCopy">
          {systemOf(navigator.platform) === 'mac' ? 'Show in Finder' : 'Show in file manager'}
        </StatusCommand>
        <StatusCommand command="tab.copyLocalPath" variant="ghost">
          <CopyFaces said={said}>Copy path</CopyFaces>
        </StatusCommand>
      </StatusActions>
      <CopyStatus said={said} />
    </>
  );
}

/** The local copy's details while it fetches: how far, in Lo's words, and Git's own behind Details. */
function Fetching({ line, said }: { line: string; said: string | undefined }) {
  const { more, shown } = useDetails(said, 'pt-2');
  return (
    <>
      <StatusLine>{line}</StatusLine>
      {said !== undefined && <StatusActions flush>{more}</StatusActions>}
      {shown}
    </>
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
        <StatusLine>
          {connection.remaining.toLocaleString('en-US')} requests left.{' '}
          {explain({ kind: 'rateLimit', resets: connection.reset })}
        </StatusLine>
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

/** One of the tab's banners, its own or another feature's, with what it says. */
type Entry =
  | { readonly id: string; readonly said: BannerSaid; readonly own: BannerSpec }
  | { readonly id: string; readonly said: BannerSaid; readonly view: BannerView };

/** How urgent each tone is: the tab shows its most urgent banner first. */
const URGENCY: Readonly<Record<BannerSaid['tone'], number>> = { danger: 0, warn: 1, info: 2 };

/**
 * Another feature's banner, as it draws it while it has one, and as it last drew it once it has
 * none, while the row it was in closes: the row leaves with what it said, not empty.
 */
function Held({
  view,
  tab,
  drawn,
}: {
  view: BannerView;
  tab: PullTab;
  drawn: Map<string, BannerProps>;
}) {
  const subscribe = useCallback(
    (listener: () => void) => view.subscribe(tab, listener),
    [view, tab],
  );
  const shows = useSyncExternalStore(subscribe, () => view.said(tab) !== undefined);
  const hear = useCallback(
    (props: BannerProps) => {
      drawn.set(view.id, props);
    },
    [drawn, view.id],
  );
  if (shows) {
    return (
      <BannerDrawn value={hear}>
        <view.render tab={tab} />
      </BannerDrawn>
    );
  }
  const last = drawn.get(view.id);
  return last ? <Banner {...last} /> : null;
}

/**
 * The tab's banner: one at a time, the most urgent first, then in the slot's order, its own first,
 * with "+1" for the rest, which moves to the next. The row opens as the first comes and closes as
 * the last goes, with the Open move, and one gives way to the next in place. A banner that arrives
 * behind the one shown is said, politely, to a screen reader.
 */
export function Banners({ tab, view }: { tab: PullTab; view: PullView | undefined }) {
  const dismissed = useTabState(dismissedNewer, tab.id);
  const chosen = useTabState(front, tab.id);
  const revisions = useRevisions(tab.id);
  const own = bannersFor(view, dismissed, revisions?.revisions);
  const views: readonly BannerView[] = useViews(bannerSlot);
  const drawn = useRef(new Map<string, BannerProps>()).current;
  const row = useRef<HTMLDivElement>(null);
  const heard = useRef<HTMLDivElement>(null);
  const alerted = useRef<HTMLDivElement>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = views.map((each) => each.subscribe(tab, listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    [views, tab],
  );
  // What the views that show a banner for the tab now say, the same list for as long as it says
  // the same, so it compares.
  const kept = useRef<{ key: string; said: ReadonlyMap<string, BannerSaid> }>({
    key: '',
    said: new Map(),
  });
  const saying = useSyncExternalStore(subscribe, () => {
    const said = views.flatMap((each) => {
      const words = each.said(tab);
      return words ? [[each.id, words] as const] : [];
    });
    const key = JSON.stringify(said);
    if (key !== kept.current.key) kept.current = { key, said: new Map(said) };
    return kept.current.said;
  });
  const entries: Entry[] = [
    ...own.map((spec) => ({
      id: spec.id,
      said: { tone: spec.tone, title: spec.title },
      own: spec,
    })),
    ...views.flatMap((each) => {
      const said = saying.get(each.id);
      return said ? [{ id: each.id, said, view: each }] : [];
    }),
  ].toSorted((a, b) => URGENCY[a.said.tone] - URGENCY[b.said.tone]);
  const at = Math.max(
    0,
    entries.findIndex((entry) => entry.id === chosen),
  );
  const entry = entries[at];
  const place: BannerPlace = {
    more:
      entries.length > 1
        ? {
            count: entries.length - 1,
            next: () => front.set(tab.id, entries[(at + 1) % entries.length]?.id ?? null),
          }
        : undefined,
    row,
    view: { focus: focusMiddle },
  };
  // The row says each banner once, as it comes: politely as it arrives, or comes to the front, and
  // a danger one, which takes the front, assertively. A title that changes in place isn't said
  // again, and what was said goes once a banner leaves.
  const ids = entries.map((each) => each.id).join('\n');
  const before = useRef<{ ids: ReadonlySet<string>; front: string | undefined } | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const now = new Set(ids === '' ? [] : ids.split('\n'));
    const was = before.current;
    const arrived = was && entries.find((each) => !was.ids.has(each.id));
    const urgent = arrived?.said.tone === 'danger' ? arrived : undefined;
    before.current = { ids: now, front: urgent?.id ?? entry?.id };
    if (!was) return;
    if (urgent && urgent.id !== entry?.id) front.set(tab.id, urgent.id);
    const polite = heard.current;
    const assertive = alerted.current;
    if (!polite || !assertive) return;
    if ([...was.ids].some((id) => !now.has(id))) {
      polite.textContent = '';
      assertive.textContent = '';
    }
    if (urgent) {
      assertive.textContent = urgent.said.title;
    } else if (arrived) {
      polite.textContent = arrived.said.title;
    } else if (entry && entry.id !== was.front) {
      polite.textContent = entry.said.title;
    }
    // The row closes with focus in it, which can't stay as the row goes inert: the view takes it.
    if (entry === undefined && was.ids.size > 0) handOffFocus([row.current], () => [place.view]);
  });
  const body =
    entry === undefined ? null : 'own' in entry ? (
      <OwnBanner tab={tab} spec={entry.own} newer={view?.newer ?? null} />
    ) : (
      <Held view={entry.view} tab={tab} drawn={drawn} />
    );
  return (
    <>
      <div ref={row} className="flex flex-none flex-col" data-lo-banners>
        <Collapse open={entry !== undefined}>
          <BannerPlaceProvider value={place}>
            <Swap id={entry?.id ?? 'none'}>{body}</Swap>
          </BannerPlaceProvider>
        </Collapse>
      </div>
      <div ref={heard} aria-live="polite" className="sr-only" data-lo-banners-heard />
      <div ref={alerted} aria-live="assertive" className="sr-only" data-lo-banners-alerted />
    </>
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
