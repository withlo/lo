// A pull request's tab: its header, its banners, the left panel, the middle sheet and the right
// panel other features fill, and its status bar. Until the diff and the threads arrive,
// the middle says what's coming.

import { Banner, PRHeader, Spinner, StatusBar, StatusItem, type HeaderConnection } from '@lo/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { client } from '../../../window/ipc.ts';
import { Slot, useViews } from '../../../window/slots.tsx';
import { contract as settings } from '../../settings/contract.ts';
import { viewIds, type Connection, type LocalState, type PullView } from '../contract.ts';
import {
  bannersFor,
  MOST_BANNERS,
  short,
  systemClock,
  type BannerDo,
  type BannerSpec,
} from './banners.ts';
import { main } from './main.ts';
import {
  banners as bannerSlot,
  header,
  left,
  middle,
  right,
  status,
  useLocalCopy,
  usePull,
  useTabs,
  type PullTab,
} from './shared.ts';
import { middleIds, panels, useTabPanels, viewCounts } from './panels.ts';
import { Placeholder } from './Placeholder.tsx';
import { ViewSwitch } from './ViewSwitch.tsx';

/** The time now, ticking each second while `ticking`, for what counts down. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? now : Date.now();
}

/** The header's chip for how the tab stands with GitHub, when it isn't as usual. */
function headerConnection(connection: Connection | undefined): HeaderConnection | undefined {
  const clock = systemClock(Date.now());
  switch (connection?.kind) {
    case 'signedOut':
      return { tone: 'danger', label: 'Signed out' };
    case 'rateLimited':
      return {
        tone: 'warn',
        label: 'Rate limited',
        detail: `until ${clock.time(connection.until)}`,
      };
    case 'offline':
      return {
        tone: 'warn',
        label: 'Offline',
        detail: connection.savedAt === null ? undefined : `saved ${clock.time(connection.savedAt)}`,
      };
    case 'live':
    case 'limitLow':
    case undefined:
      return undefined;
    default:
      connection satisfies never;
      return undefined;
  }
}

/** Does what a banner's button says, for tab `id`. */
function run(id: string, action: BannerDo): void {
  const done = (() => {
    switch (action.kind) {
      case 'retry':
        return main().retry({ id });
      case 'reload':
        return main().reload({ id });
      case 'choose':
        return main().choose({ id, login: action.login });
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
  done.catch((error: unknown) => console.error("Lo couldn't do what the banner offered:", error));
}

/**
 * Lo's own banners for a tab, most urgent first, counting down while something does. A view of
 * another layer than the pull request its tab opened on can go back to that one.
 */
function useBanners(
  tab: PullTab,
  view: PullView | undefined,
  local: LocalState | undefined,
): BannerSpec[] {
  const counting =
    view?.problem?.kind === 'failed' ||
    view?.connection.kind === 'offline' ||
    view?.connection.kind === 'rateLimited' ||
    local?.kind === 'retrying';
  const now = useNow(counting);
  const held = useTabs().tabs.find((each) => viewIds([each]).includes(tab.id));
  const own = held?.kind === 'pull' && held.number !== tab.number ? held.number : undefined;
  return bannersFor(view, local, `${tab.owner}/${tab.repo}`, systemClock(now), own);
}

/** The banners: Lo's own, then other features', two at most, the most urgent first. */
function Banners({ tab, own: all }: { tab: PullTab; own: readonly BannerSpec[] }) {
  const own = all.slice(0, MOST_BANNERS);
  const others = useViews(bannerSlot).slice(0, MOST_BANNERS - own.length);
  if (own.length === 0 && others.length === 0) return null;
  return (
    <div className="flex flex-none flex-col" data-lo-banners>
      {own.map((banner) => (
        <Banner
          key={banner.id}
          tone={banner.tone}
          title={banner.title}
          detail={banner.detail}
          actions={banner.actions.map((action) => ({
            label: action.label,
            onClick: () => run(tab.id, action.do),
          }))}
        />
      ))}
      {others.map((other) => (
        <other.render key={other.id} tab={tab} />
      ))}
    </div>
  );
}

/**
 * The banners past the two shown, folded into the status bar: each a dot and its first words, a
 * button for what it offers first, if anything.
 */
function FoldedBanners({ tab, folded }: { tab: PullTab; folded: readonly BannerSpec[] }) {
  return folded.map((banner) => {
    const [first] = banner.actions;
    const dot = banner.tone === 'danger' ? 'fail' : banner.tone === 'warn' ? 'warn' : 'busy';
    return (
      <StatusItem
        key={banner.id}
        dot={dot}
        title={[banner.title, banner.detail].filter(Boolean).join(' ')}
        onClick={first === undefined ? undefined : () => run(tab.id, first.do)}
      >
        {first === undefined ? banner.title : first.label}
      </StatusItem>
    );
  });
}

/** The status bar's item for the local copy: a dot, and what it's doing while it does something. */
function LocalItem({ local }: { local: LocalState | undefined }): ReactNode {
  switch (local?.kind) {
    case undefined:
    case 'waiting':
      return null;
    case 'noGit':
      return <StatusItem dot="idle">No git</StatusItem>;
    case 'fetching':
      return (
        <StatusItem title={local.progress ?? undefined}>
          <Spinner size="xs" />
          Local copy{local.progress === null ? '' : ` · ${local.progress}`}
        </StatusItem>
      );
    case 'ready':
      return (
        <StatusItem dot={local.offline ? 'warn' : 'ok'} title={`At ${short(local.head)}`}>
          Local copy{local.offline ? ' · offline' : ''}
        </StatusItem>
      );
    case 'retrying':
      return <StatusItem dot="warn">Local copy · retrying</StatusItem>;
    case 'failed':
      return <StatusItem dot="fail">Local copy · failed</StatusItem>;
    default:
      local satisfies never;
      return null;
  }
}

/** A pull request's tab, as its kind draws it. */
export function PullRequestTab({ tab }: { tab: PullTab }) {
  const view = usePull(tab.id);
  const local = useLocalCopy(tab.id);
  const banners = useBanners(tab, view, local);
  const { leftOpen } = useTabPanels(tab.id);
  const lefts = useViews(left);
  const middles = useViews(middle);
  const rights = useViews(right);
  viewCounts.left = lefts.length;
  viewCounts.middle = middles.length;
  if (middleIds.ids.length !== middles.length) middleIds.ids = middles.map((each) => each.id);
  const heading = view?.header;
  const acting = view?.acting;
  const showLeft = leftOpen && lefts.length > 0;
  const showRight = rights.length > 0;
  const shownMiddle = middles[panels.get(tab.id).middle % Math.max(1, middles.length)];
  // The middle views shown since the tab was drawn stay drawn, hidden while another is on screen.
  const [kept, setKept] = useState<readonly string[]>([]);
  if (shownMiddle && !kept.includes(shownMiddle.id)) setKept([...kept, shownMiddle.id]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-lo-pull={tab.id}>
      <PRHeader
        number={tab.number}
        title={heading?.title ?? tab.title}
        state={heading?.state ?? tab.state}
        author={heading?.author}
        head={heading?.head}
        base={heading?.base}
        acting={
          acting === undefined || acting === null
            ? undefined
            : acting.kind === 'anonymous'
              ? 'anonymous'
              : { login: acting.login }
        }
        connection={headerConnection(view?.connection)}
      >
        <Slot slot={header} props={{ tab }} />
        <span className="min-w-8 flex-1" />
        <ViewSwitch tab={tab} views={middles} shown={shownMiddle?.id} />
      </PRHeader>
      <Banners tab={tab} own={banners} />
      <div className="flex min-h-0 flex-1">
        {showLeft && (
          <aside
            className="flex w-panel-left-w min-w-0 flex-none flex-col bg-bg-chrome"
            aria-label="Files"
          >
            <Slot slot={left} props={{ tab }} />
          </aside>
        )}
        <section
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden sheet"
          aria-label="Pull request"
        >
          {shownMiddle ? (
            middles
              .filter((each) => each === shownMiddle || kept.includes(each.id))
              .map((each) => {
                const shown = each === shownMiddle;
                return (
                  <div
                    key={each.id}
                    className={shown ? 'absolute inset-0' : 'invisible absolute inset-0'}
                    inert={!shown}
                    data-lo-middle-view={each.id}
                  >
                    <each.render tab={tab} shown={shown} />
                  </div>
                );
              })
          ) : (
            <Placeholder tab={tab.id} />
          )}
        </section>
        {showRight && (
          <aside
            className="flex w-panel-right-w min-w-0 flex-none flex-col bg-bg-chrome"
            aria-label="Threads"
          >
            <Slot slot={right} props={{ tab }} />
          </aside>
        )}
      </div>
      <StatusBar
        start={
          <>
            <FoldedBanners tab={tab} folded={banners.slice(MOST_BANNERS)} />
            <LocalItem local={local} />
            {view?.connection.kind === 'limitLow' && (
              <StatusItem dot="warn" title={`${view.connection.remaining} requests left`}>
                Rate limit low
              </StatusItem>
            )}
            <Slot slot={status} props={{ tab }} />
          </>
        }
      />
    </div>
  );
}
