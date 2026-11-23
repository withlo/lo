// The code feature in main: trust, and the syntax index. For each view of a pull request's tab,
// whether language servers may run on it, decided from the trusted entries in the settings file
// and, once one names the view, the repositories' node IDs read from GitHub, and sent to the window
// each time it changes. Trust is written only here, once main's own dialog, attached to the window
// that asked, says "Trust"; the banner, the palette and Settings only ask. Taking trust away,
// however the settings file loses an entry, lets go of what ran on it: its checkouts are removed.
// So does a view no longer trusted for any other reason, once no other view of its pull request is.
//
// The syntax index needs no trust: it reads blobs through git, never runs the repository's code,
// and has the background process parse them, over main's own port. Its store is in the cache, on
// a worker thread of main's, and the window asks it questions over the code port, a port of main's
// own handed to each load of the page.
//
// Language servers run only on views the reader trusts, on a checkout of the head on screen, one
// for each repository and language (`servers.ts`, `serving.ts`). On the new side, a server's
// answer within its deadline wins over the index's (`served.ts`). The toolchains they use, Lo's own
// copies, are in the cache's `toolchains/`, which Settings lists and removes (`toolchains.ts`).

import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { type Cache, defaultPlaces, parseOid, serverGitEnvironment, whyDistrusted } from '@lo/git';
import {
  currentPlatform,
  developerFolder,
  downloadFor,
  findCopy,
  Installer,
  type InstallProgress,
  MANIFEST,
  type Manifest,
  partsOf,
  startServer,
  TOOLCHAINS,
  toolchainsFor,
  toolchainUse,
  versionFor,
} from '@lo/lsp';
import { app, BrowserWindow, dialog, MessageChannelMain, net } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { codeHandOver, jobs, type CodeHandOver } from '../../../ipc/jobs.ts';
import { mainJobs, portOf } from '../../../main/background.ts';
import { githubSettings } from '../../../main/environment.ts';
import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { netFetch } from '../../../main/fetch.ts';
import { github } from '../../accounts/service.ts';
import { comparisons } from '../../revisions/service.ts';
import { clearing, settings } from '../../settings/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { contract as codeJobs } from '../jobs.ts';
import { hints, readTrusted, trusted, type TrustEntry } from '../settings.ts';
import {
  ADAPTERS,
  type Adapter,
  prepareContext,
  SWIFT_DISTRO,
  type Toolchain,
} from './adapters.ts';
import { letGo, letGoUntrusted } from './checkouts.ts';
import { TrustAsker, type AskWindow } from './confirm.ts';
import { readRepositories, type RepositoryReading } from './repositories.ts';
import { Dismissed } from './dismissed.ts';
import {
  dropsFor,
  goneFrom,
  meant,
  removes,
  withEntry,
  withoutEntries,
  type Drop,
} from './entries.ts';
import { TrustViews, type ViewInfo } from './views.ts';
import { snippet, type Answering } from './answers.ts';
import { CodeIndex, type ViewInput, type ViewSides } from './indexer.ts';
import { servePort, type Answerers } from './serve.ts';
import {
  servedDefinitions,
  servedHints,
  servedHover,
  servedOutline,
  servedReferences,
  type ServerOf,
} from './served.ts';
import { DownloadSum } from './downloads.ts';
import { ServerPool, serversFolder } from './servers.ts';
import {
  checkoutRefusal,
  listedToolchain,
  listToolchains,
  removalFailure,
  removeToolchain,
  toolchainFailure,
  type ToolchainHost,
} from './toolchains.ts';
import { repoKey, ServingViews, type ServingInput } from './serving.ts';
import { adaptersFor } from './tests.ts';
import { storeWorker, type SymbolStore } from './store/client.ts';
// electron-vite builds the store's worker and gives its path as this import's default.
// oxlint-disable-next-line import/default
import storeEntry from './store/worker.ts?modulePath';

type Context = FeatureContext<typeof contract>;

/**
 * How long main waits for one of its jobs: they wait behind the window's, which may take a while,
 * and each has a deadline of its own once it runs.
 */
const JOB_WAIT = 10 * 60_000;

/**
 * How long main waits for a hover's Markdown to be read, which goes ahead of its other jobs, such as
 * the index's: past it the job is cancelled and the index answers, so a card isn't long in coming.
 */
const RENDER_WAIT = 5_000;

const log = (line: string) => console.error(`code: ${line}`);

/**
 * The toolchains this system may install, which Settings lists and removes, and which Lo removes
 * the rest of as it starts: those `toolchains.json` pins, Swift's only for the Linux distribution
 * the system takes, so another's goes once the system is upgraded past it.
 */
const SYSTEM_TOOLCHAINS: Manifest = toolchainsFor(TOOLCHAINS, SWIFT_DISTRO);

let views: TrustViews | undefined;
let asker: TrustAsker<BrowserAsk> | undefined;
let dismissed: Dismissed | undefined;
const stops: (() => void)[] = [];
let index: CodeIndex | undefined;
let store: SymbolStore | undefined;
let pool: ServerPool | undefined;
let serving: ServingViews | undefined;
/** The language servers Lo can run, once servers start: its own, or in a test run, a test's. */
let adapters: readonly Adapter[] = [];
/** What downloads language servers, once the first one is needed. */
let installer: Installer | undefined;
/** What downloads the toolchains they use, once the cache is open. */
let toolchainInstaller: Installer | undefined;
/** Settings' view of the toolchains, once servers are followed. */
let toolchainHost: ToolchainHost | undefined;
/** The code port of each window's page, by its contents' id, while it's loaded. */
const ports = new Map<number, () => void>();

/**
 * What hears of checkouts no longer trusted, once an entry is out of the settings file, however it
 * went: each stops what runs on them, then lets go of them.
 */
const untrusted = new Set<(drop: Drop) => Promise<void>>();

/** The window that asked, which the dialog is attached to. */
interface BrowserAsk extends AskWindow {
  readonly browser: BrowserWindow;
}

/** The window Electron numbers `id`, while it's open. */
function windowOf(id: number | undefined): BrowserAsk | undefined {
  const browser = id === undefined ? undefined : BrowserWindow.fromId(id);
  if (!browser || browser.isDestroyed()) return undefined;
  return {
    browser,
    onClosed(listener) {
      browser.once('closed', listener);
      return () => {
        browser.off('closed', listener);
      };
    },
  };
}

function viewsOf(): TrustViews {
  if (!views) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
  return views;
}

/** View `id` as the decision needs it, or nothing once it's closed. */
function viewInfo(context: Context, id: string): ViewInfo | undefined {
  const info = context.use(tabs).pull(id);
  if (!info) return undefined;
  const git = context.git.status?.status;
  const fork = info.head?.fork;
  return {
    id,
    repo: `${info.repository.owner}/${info.repository.name}`,
    number: info.number,
    noGit:
      info.local.kind === 'noGit' || git === 'missing' || git === 'tooOld'
        ? true
        : git === undefined
          ? undefined
          : false,
    local: info.local.kind === 'ready',
    fork: fork === undefined ? undefined : fork && `${fork.owner}/${fork.name}`,
    canRead: info.acting !== undefined,
    heads: `${info.latest ?? ''} ${info.shown ?? ''}`,
  };
}

/**
 * Takes out of the settings file the entries `take` picks. Watching the file, Lo then lets go of
 * what they trusted.
 */
async function untrust(context: Context, take: (entry: TrustEntry) => boolean): Promise<void> {
  await context.use(settings).update(trusted, (list) => withoutEntries(list, take).list);
}

/** Tells those that hear of checkouts no longer trusted, without holding up what changed. */
function letGoOf(drops: readonly Drop[]): void {
  for (const drop of drops) {
    for (const listener of untrusted) {
      listener(drop).catch((error: unknown) => {
        log(`couldn't let go of what ran on ${drop.repo}: ${String(error)}`);
      });
    }
  }
}

/** View `id` as the index follows it: what it compares, once the local copy has it. */
function indexInput(context: Context, id: string): ViewInput | undefined {
  const info = context.use(tabs).pull(id);
  if (!info) return undefined;
  const git = context.git.status?.status;
  if (info.local.kind === 'noGit' || git === 'missing' || git === 'tooOld')
    return { kind: 'noGit' };
  const { local } = info;
  if (local.kind !== 'ready') return { kind: 'waiting' };
  const clone = () => context.use(tabs).clone(id);
  const screen = context.use(comparisons).onScreen(id);
  switch (screen.kind) {
    case 'waiting':
      return { kind: 'waiting' };
    case 'revisions':
      return {
        kind: 'ready',
        clone,
        new: screen.comparing.new.head,
        old: screen.comparing.old.head,
        offline: local.offline,
      };
    case 'head':
      // Until the copy is at the head on screen, and compared with what the tab compares it with.
      if (local.head !== info.shown || (local.from?.commit ?? undefined) !== info.compareFrom) {
        return { kind: 'waiting' };
      }
      return {
        kind: 'ready',
        clone,
        new: parseOid(local.head),
        old: local.mergeBase === null ? undefined : parseOid(local.mergeBase),
        offline: local.offline,
      };
    default:
      screen satisfies never;
      return { kind: 'waiting' };
  }
}

/**
 * The store, once the cache is open, for each of its operations: until then they wait for it, but
 * clearing it has nothing to clear.
 */
function lazyStore(opened: Promise<SymbolStore>) {
  return {
    fresh: async (...args: Parameters<SymbolStore['fresh']>) => (await opened).fresh(...args),
    put: async (...args: Parameters<SymbolStore['put']>) => (await opened).put(...args),
    setTree: async (...args: Parameters<SymbolStore['setTree']>) => (await opened).setTree(...args),
    definitions: async (...args: Parameters<SymbolStore['definitions']>) =>
      (await opened).definitions(...args),
    referrers: async (...args: Parameters<SymbolStore['referrers']>) =>
      (await opened).referrers(...args),
    kept: async (...args: Parameters<SymbolStore['kept']>) => (await opened).kept(...args),
    trim: async (...args: Parameters<SymbolStore['trim']>) => (await opened).trim(...args),
    clear: async () => store?.clear(),
  };
}

/** View `id`'s sides for a question, or why it can't be answered yet. */
function sidesOf(id: string): ViewSides {
  const sides = index?.sides(id);
  if (sides) return sides;
  const state = index?.state(id);
  if (state?.kind === 'noGit') throw new IpcError('unavailable', 'Code features need git.');
  throw new IpcError('unavailable', 'Fetching local copy…');
}

/** The language server for a file of view `view`'s new side, if one reads it there. */
function serverOf(view: string): ServerOf {
  return (file) => serving?.serverFor(view, file.commit, file.path);
}

/**
 * What answers each of the code port's questions: a language server first, on the new side of a
 * view the reader trusts, else the syntax index.
 */
function answerers(answering: Answering): Answerers {
  return {
    definitions: (input, signal) =>
      servedDefinitions(answering, sidesOf(input.view), input, signal, serverOf(input.view)),
    references: (input, signal) =>
      servedReferences(answering, sidesOf(input.view), input, signal, serverOf(input.view)),
    hover: (input, signal) =>
      servedHover(answering, sidesOf(input.view), input, signal, serverOf(input.view)),
    hints: (input, signal) => servedHints(sidesOf(input.view), input, signal, serverOf(input.view)),
    outline: (input, signal) =>
      servedOutline(answering, sidesOf(input.view), input, signal, serverOf(input.view)),
    snippet: (input) => snippet(sidesOf(input.view), input),
  };
}

/**
 * Hands each load of `window`'s page a new code port, closing the one before. A port answers about
 * any open view while its window is alive. That's all a view of another window would need checking
 * for, and there's none: Lo has one window, which every tab is in, and tabs aren't kept by window.
 */
function handPorts(context: Context, window: BrowserWindow, answer: Answerers): void {
  const contents = window.webContents;
  const id = contents.id;
  const close = () => {
    ports.get(id)?.();
    ports.delete(id);
  };
  contents.on('did-finish-load', () => {
    close();
    const { port1, port2 } = new MessageChannelMain();
    const handOver: CodeHandOver = { type: codeHandOver };
    contents.postMessage(codeHandOver, handOver, [port2]);
    ports.set(
      id,
      servePort(portOf(port1), {
        isOpen: (view) => !window.isDestroyed() && context.use(tabs).pull(view) !== undefined,
        answer,
        log,
      }),
    );
  });
  contents.once('destroyed', close);
}

/** Starts the syntax index: its store once the cache opens, its views, and the code port. */
function startIndex(context: Context): void {
  const background = jobs(codeJobs, mainJobs);
  const { promise: ready, resolve: opened } = Promise.withResolvers<SymbolStore>();
  stops.push(
    context.git.onCache((cache) => {
      if (store) return;
      store = storeWorker(storeEntry, join(cache.root, 'code', 'symbols.db'));
      opened(store);
    }),
  );
  const symbols = lazyStore(ready);
  const read = (files: Parameters<typeof background.symbols>[0]['files'], signal?: AbortSignal) =>
    background.symbols({ files }, { signal, timeout: JOB_WAIT });
  const followed = new CodeIndex({
    store: symbols,
    read,
    publish: (view, state) => context.publish('indexed', { view, state }),
    onScreen: () => context.use(tabs).list().active,
    log,
  });
  index = followed;
  const answer = answerers({
    store: symbols,
    version: () => followed.version(),
    read,
    find: (name, files, signal) => background.find({ name, files }, { signal, timeout: JOB_WAIT }),
    render: (view, markdown, signal) => {
      const repository = context.use(tabs).pull(view)?.repository;
      const repo = repository ? { owner: repository.owner, name: repository.name } : null;
      return background.render({ markdown, repo }, { signal, timeout: RENDER_WAIT });
    },
  });
  const follow = (id: string) => followed.follow(id, indexInput(context, id));
  const service = context.use(tabs);
  stops.push(
    service.onPull(follow),
    context.use(comparisons).onChange(follow),
    context.use(clearing).onClear(() => {
      followed
        .clear()
        .catch((error: unknown) => log(`couldn't clear the syntax index: ${String(error)}`));
    }),
  );
  context.git.onStatus(() => {
    for (const tab of service.list().tabs) if (tab.kind === 'pull') follow(tab.id);
  });
  for (const tab of service.list().tabs) if (tab.kind === 'pull') follow(tab.id);
  const created = (_event: unknown, window: BrowserWindow) => handPorts(context, window, answer);
  app.on('browser-window-created', created);
  stops.push(() => app.off('browser-window-created', created));
  for (const window of BrowserWindow.getAllWindows()) handPorts(context, window, answer);
}

/** View `id` as its language servers follow it, or nothing once it's closed. */
function servingInput(context: Context, id: string): ServingInput | undefined {
  const info = context.use(tabs).pull(id);
  if (!info) return undefined;
  const trust = views?.decision(id)?.trust;
  const kind = trust?.kind;
  const { local, shown } = info;
  const compared = indexInput(context, id);
  return {
    id,
    repo: `${info.repository.owner}/${info.repository.name}`,
    number: info.number,
    // A read that failed, as offline, or no git, decides nothing.
    trust:
      kind === 'trusted'
        ? 'trusted'
        : kind === 'checking' || kind === 'waiting'
          ? 'checking'
          : trust?.kind === 'untrusted' && trust.why !== 'unread'
            ? 'none'
            : 'unknown',
    off: kind === 'untrusted',
    head:
      local.kind === 'ready' && shown !== undefined && local.head === shown
        ? parseOid(shown)
        : undefined,
    sides: compared?.kind === 'ready' ? { new: compared.new, old: compared.old } : undefined,
    clone: () => context.use(tabs).clone(id),
  };
}

/** `owner/name`'s owner and name, or nothing unless it's two parts. */
function ownerAndName(repo: string): { owner: string; name: string } | undefined {
  const [owner, name, ...rest] = repo.split('/');
  return owner === undefined || name === undefined || rest.length > 0 ? undefined : { owner, name };
}

/**
 * A server's `HOME`, the cache's home for it (`code/homes/<owner>/<name>/<adapter>`), or nothing
 * for a name that can't be a folder's.
 */
function homeOf(cache: Cache, repo: string, adapter: Adapter): string | undefined {
  const parts = ownerAndName(repo);
  if (!parts) return undefined;
  try {
    return cache.homeFolder(parts.owner, parts.name, adapter.id);
  } catch {
    return undefined;
  }
}

/** How downloads go: through Chromium's network stack, with the system's proxy, as every read Lo makes. */
function downloadFetch(): typeof globalThis.fetch {
  return netFetch((options) => net.request(options), { stream: true });
}

/** What installs language servers, once the cache is open. */
function serverInstaller(context: Context): Installer | undefined {
  const cache = context.git.cache;
  if (!cache) return undefined;
  installer ??= new Installer({ folder: serversFolder(cache.root), fetch: downloadFetch() });
  return installer;
}

/** What installs the toolchains, once the cache is open: in its folder the cap doesn't count. */
function toolchainsInstaller(context: Context): Installer | undefined {
  const cache = context.git.cache;
  if (!cache) return undefined;
  toolchainInstaller ??= new Installer({ folder: cache.toolchainsFolder, fetch: downloadFetch() });
  return toolchainInstaller;
}

/** What `manifest` pins as `id`, if it does. */
function pinnedIn(manifest: Manifest, id: string) {
  return Object.hasOwn(manifest, id) ? manifest[id] : undefined;
}

/**
 * Installs what Lo's manifest pins as `id`, in the cache, reporting the download's progress. One
 * Lo builds from its Go modules is built with `go`, Lo's Go.
 */
function install(
  context: Context,
  id: string,
  progress: InstallProgress,
  signal: AbortSignal,
  go: Toolchain | undefined,
) {
  const installing = serverInstaller(context);
  if (!installing) throw new Error('Lo has no cache to download language servers into.');
  const pinned = pinnedIn(MANIFEST, id);
  if (!pinned) throw new Error(`Lo's list of language servers has no ${id}.`);
  return installing.install(id, pinned, {
    signal,
    progress,
    go: go && { version: go.version, installed: go.installed },
  });
}

/**
 * Installs the toolchain `toolchains.json` pins as `id`, reporting the download's progress, and
 * says what a server gets of it. A failure names it, and Settings hears once one it downloaded is
 * there, or isn't.
 */
async function installToolchain(
  context: Context,
  id: string,
  progress: InstallProgress,
  signal: AbortSignal,
): Promise<Toolchain> {
  const installing = toolchainsInstaller(context);
  if (!installing) throw new Error('Lo has no cache to download toolchains into.');
  const pinned = pinnedIn(SYSTEM_TOOLCHAINS, id);
  if (!pinned) throw new Error(`Lo's list of toolchains has no ${id}.`);
  let downloaded = false;
  try {
    const installed = await installing.install(id, pinned, {
      signal,
      progress: (done, total, stage) => {
        downloaded = true;
        progress(done, total, stage);
      },
    });
    // A platform its vendor hasn't published the newest for yet installs an older version.
    const platform = currentPlatform();
    const version = platform === undefined ? pinned.version : versionFor(pinned, platform);
    return { version, installed, ...toolchainUse(id, version, installed) };
  } catch (error) {
    throw signal.aborted ? error : toolchainFailure(id, error);
  } finally {
    if (downloaded) publishToolchains(context);
  }
}

/** Tells Settings what the toolchains are now. */
function publishToolchains(context: Context): void {
  if (!toolchainHost) return;
  listToolchains(toolchainHost).then(
    (listed) => context.publish('downloaded', listed),
    (error: unknown) => log(`couldn't list the toolchains: ${String(error)}`),
  );
}

/**
 * Gets `adapter`'s server ready, its downloads added up from the start: each it names that isn't
 * installed yet counts its whole size from the first byte.
 */
async function prepareServer(
  context: Context,
  adapter: Adapter,
  progress: InstallProgress,
  signal: AbortSignal,
) {
  const sum = new DownloadSum(progress);
  const platform = currentPlatform();
  const expect = async (
    kind: 'server' | 'toolchain',
    ids: readonly string[] | undefined,
    manifest: Manifest,
    installing: Installer | undefined,
  ) => {
    for (const id of ids ?? []) {
      const pinned = pinnedIn(manifest, id);
      const download = pinned && platform && downloadFor(pinned, platform);
      if (!pinned || !download || !installing) continue;
      if (await installing.installed(id, pinned).catch(() => undefined)) continue;
      sum.expect(
        `${kind}:${id}`,
        partsOf(download).reduce((total, part) => total + part.size, 0),
      );
    }
  };
  await expect('server', adapter.downloads?.servers, MANIFEST, serverInstaller(context));
  await expect(
    'toolchain',
    adapter.downloads?.toolchains,
    SYSTEM_TOOLCHAINS,
    toolchainsInstaller(context),
  );
  const counted = async <T>(key: string, start: (heard: typeof progress) => Promise<T>) => {
    const part = sum.part(key);
    const done = await start(part.progress);
    part.done();
    return done;
  };
  return adapter.prepare(
    prepareContext({
      install: (id, options) =>
        counted(`server:${id}`, (heard) => install(context, id, heard, signal, options?.go)),
      toolchain: listedToolchain(adapter, (id) =>
        counted(`toolchain:${id}`, (heard) => installToolchain(context, id, heard, signal)),
      ),
      findCopy: (candidates) => installedCopy(context, candidates),
      signal,
    }),
  );
}

/** The first of `candidates` that may run as a server: a copy the user installed. */
async function installedCopy(context: Context, candidates: readonly string[]) {
  const cache = context.git.cache;
  const { groups } = defaultPlaces(process.platform);
  const found = await findCopy(candidates, {
    distrust: (program) => whyDistrusted(program, groups),
    outside: cache ? [cache.root] : [],
    home: homedir(),
  });
  return found.program;
}

/**
 * Starts following views for their language servers: Lo's own, or the servers a test names, the
 * pool they run in, and each view's needs, as its tab, its comparison, its trust, git and the view
 * on screen change.
 */
function startServers(context: Context): void {
  const packaged = app.isPackaged;
  const { testRun } = githubSettings({ packaged, env: process.env });
  adapters = adaptersFor({ packaged, env: process.env, testRun, shipped: ADAPTERS });
  const servers = new ServerPool({
    prepare: (adapter, progress, signal) => prepareServer(context, adapter, progress, signal),
    checkout: checkoutRefusal,
    start: (spec) => startServer({ ...spec, version: app.getVersion() }),
    base(repo, adapter) {
      const cache = context.git.cache;
      const found = context.git.status;
      if (!cache || found?.status !== 'found') return undefined;
      const home = homeOf(cache, repo, adapter);
      if (home === undefined) return undefined;
      // Lo's own git, after the toolchain's folders: it's new enough for the settings git's
      // variables give it.
      return { home, git: serverGitEnvironment(), path: [dirname(found.git.program)] };
    },
    // Cleanup takes nothing of the repository while its server runs, its home included.
    async hold(repo, adapter, signal) {
      const cache = context.git.cache;
      const parts = ownerAndName(repo);
      if (!cache || !parts) return () => undefined;
      return cache.useForServer(parts.owner, parts.name, adapter.id, { signal });
    },
    changed: (repo) => serving?.changed(repo),
    log,
  });
  pool = servers;
  toolchainHost = {
    manifest: SYSTEM_TOOLCHAINS,
    platform: currentPlatform(),
    installer: () => toolchainsInstaller(context),
    adapters: () => adapters,
    halt: (uses, message) => servers.halt(uses, message),
    find: { findCopy: (candidates) => installedCopy(context, candidates), developerFolder },
  };
  // As Lo starts, before any server can use one, what toolchains.json no longer pins for this
  // system goes, as do downloads a Lo that stopped halfway left.
  stops.push(
    context.git.onCache(() => {
      toolchainsInstaller(context)
        ?.prune(SYSTEM_TOOLCHAINS)
        .catch((error: unknown) => log(`couldn't remove old toolchains: ${String(error)}`))
        .finally(() => publishToolchains(context));
    }),
  );
  const service = context.use(tabs);
  const followed = new ServingViews({
    pool: servers,
    adapters: () => adapters,
    view: (id) => servingInput(context, id),
    onScreen: () => service.list().active,
    publish: (shown) => context.publish('served', shown),
    stopOn: (repo, pull) => servers.stopWhere(repoKey(repo), (each) => each === pull),
    async letGo(repo, pull) {
      await servers.stopWhere(repoKey(repo), (each) => each === pull);
      const cache = context.git.cache;
      const [owner = '', name = ''] = repo.split('/');
      // Only a pull request that has checkouts, as most decided untrusted have none.
      if (cache && (await isFolder(join(cache.checkoutsFolder(owner, name), `pull-${pull}`)))) {
        await letGo(cache, { repo, pull });
      }
    },
    log,
  });
  serving = followed;
  const all = () => {
    for (const tab of service.list().tabs) if (tab.kind === 'pull') followed.update(tab.id);
  };
  stops.push(
    service.onPull((id) => followed.update(id)),
    context.use(comparisons).onChange((id) => followed.update(id)),
    // The view on screen, which servers start for and move to.
    service.onTabs(() => followed.updateAll()),
  );
  context.git.onStatus(() => all());
  all();
}

/** Whether there's a folder at `path`. */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The servers to stop for `drop`, by the pull request each runs on. */
function stoppedBy(drop: Drop): (pull: number | undefined) => boolean {
  return 'pull' in drop
    ? (pull) => pull === drop.pull
    : (pull) => pull === undefined || !drop.except.includes(pull);
}

export default defineFeature(contract, {
  uses: [tabs, github, settings, comparisons, clearing],
  handlers: {
    state: ({ view }) => viewsOf().status(view) ?? null,
    trust(request, _context, { windowId }) {
      if (!asker) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
      return asker.ask(request, windowOf(windowId));
    },
    async untrust(input, context) {
      if ('view' in input) {
        const view = viewInfo(context, input.view);
        if (!view) throw new IpcError('missing', "There's no pull request's tab with that id.");
        viewsOf().update(input.view);
        await untrust(context, meant(viewsOf().trustedBy(input.view)));
        return;
      }
      await untrust(context, (entry) => removes(input, entry));
    },
    dismiss({ view }, context) {
      const info = viewInfo(context, view);
      if (!info || !dismissed) {
        throw new IpcError('missing', "There's no pull request's tab with that id.");
      }
      dismissed.add(info.repo, Date.now());
      viewsOf().updateAll();
    },
    index: ({ view }) => index?.state(view) ?? null,
    retryIndex({ view }) {
      index?.retryNow(view);
    },
    servers: ({ view }) => serving?.servers(view) ?? null,
    async restart({ view, server }) {
      if (!serving) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
      await serving.restart(view, server);
    },
    log: ({ view, server }) => serving?.log(view, server) ?? null,
    toolchains: () => (toolchainHost ? listToolchains(toolchainHost) : []),
    async removeToolchain({ id }, context) {
      if (!toolchainHost) throw new IpcError('unavailable', 'Lo is starting, or quitting.');
      if (!Object.hasOwn(SYSTEM_TOOLCHAINS, id)) {
        throw new IpcError('missing', 'Lo has no toolchain with that id.');
      }
      try {
        await removeToolchain(toolchainHost, id);
      } catch (error) {
        log(`couldn't remove the toolchain ${id}: ${String(error)}`);
        throw new IpcError('failed', removalFailure(error));
      } finally {
        publishToolchains(context);
      }
    },
  },
  start(context) {
    // The window asks for type hints itself, so main only declares the switch, for it to change.
    context.use(settings).declare(hints);
    const service = context.use(tabs);
    const kept = new Dismissed(context.database);
    dismissed = kept;
    const access = context.use(github);
    const reading: RepositoryReading = {
      pull: (id) => service.pull(id),
      anonymous: access.anonymous,
      poller: (login) => access.poller(login),
    };
    const followed = new TrustViews({
      view: (id) => viewInfo(context, id),
      read: (view, priority, signal) => readRepositories(reading, view.id, priority, signal),
      dismissed: (repo) => kept.has(repo),
      publish(status) {
        context.publish('status', status);
        // Servers follow trust: none for a view nothing trusts.
        serving?.update(status.view);
      },
      log,
    });
    views = followed;
    startServers(context);
    asker = new TrustAsker<BrowserAsk>({
      view(id) {
        const view = viewInfo(context, id);
        return view && { id, repo: view.repo, number: view.number };
      },
      read: (view, signal) => followed.readNow(view.id, signal),
      confirm: async ({ browser }, question, signal) => {
        const { response } = await dialog.showMessageBox(browser, {
          ...question,
          buttons: [...question.buttons],
          signal,
        });
        return response;
      },
      write: (entry) => context.use(settings).update(trusted, (list) => withEntry(list, entry)),
      // The view's status says how far it has got, so its banner and status item show it.
      progress: (view, step) => followed.setTrusting(view, step),
      focus({ browser }) {
        if (browser.isDestroyed()) return;
        if (browser.isMinimized()) browser.restore();
        browser.focus();
      },
    });
    // What ran on them stops first, then the checkouts go.
    untrusted.add(async (drop) => {
      await pool?.stopWhere(repoKey(drop.repo), stoppedBy(drop));
      const cache = context.git.cache;
      if (cache) await letGo(cache, drop);
      serving?.forget(drop.repo, (pull) => stoppedBy(drop)(pull));
    });
    /** The entries as the file last had them, once it's been read. */
    let before: readonly TrustEntry[] | undefined;
    let swept = false;
    // Once, as Lo starts, the checkouts of entries taken out of the file while Lo was closed go.
    const sweep = () => {
      const cache = context.git.cache;
      if (swept || !cache || before === undefined) return;
      swept = true;
      letGoUntrusted(cache, before, log).catch((error: unknown) => {
        log(`couldn't let go of checkouts nothing trusts: ${String(error)}`);
      });
    };
    stops.push(
      context.use(settings).watch(trusted, (value) => {
        const entries = readTrusted(value).entries;
        const gone = before === undefined ? [] : goneFrom(before, entries);
        before = entries;
        // Views are decided again first, so nothing runs on what's let go of.
        followed.setEntries(entries);
        letGoOf(dropsFor(gone, entries));
        sweep();
      }),
      service.onPull((id) => {
        followed.update(id);
        // An ask about a view whose tab closed ends, giving up on what it waits for.
        asker?.update(id);
      }),
      context.git.onCache(() => sweep()),
    );
    context.git.onStatus(() => followed.updateAll());
    for (const tab of service.list().tabs) if (tab.kind === 'pull') followed.update(tab.id);
    startIndex(context);
  },
  async stop() {
    for (const stop of stops.splice(0)) stop();
    for (const close of ports.values()) close();
    ports.clear();
    untrusted.clear();
    views?.stop();
    views = undefined;
    asker = undefined;
    serving?.stop();
    serving = undefined;
    toolchainHost = undefined;
    const servers = pool;
    pool = undefined;
    index?.stop();
    index = undefined;
    const closing = store;
    store = undefined;
    // Each server stops within its own limit, inside the feature's 5 s.
    await Promise.all([servers?.stop(), closing?.stop()]);
  },
});
