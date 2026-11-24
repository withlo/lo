// Following each view of a pull request's tab for its language servers: what it needs, the
// checkout they run on, and what its status bar says of them.
//
// - Only a view the reader trusts needs servers: those whose languages its new side shows, read
//   from the files the pull request changes, and from the files it's asked about.
// - Its head on screen is checked out only once it's on screen and needs a server, so trusting a
//   repository no server reads checks out nothing. Nothing is checked out, downloaded or started
//   for a view nothing trusts.
// - A view checked again after a push holds what runs for its repository, and starts nothing,
//   until it's trusted again.
// - Once a view of a pull request is decided untrusted, for whatever reason and whatever it was
//   before, and no other view of it is trusted, then or once the one that is closes, what runs on
//   its checkouts stops and they go: one finished after that goes as it's made. While its trust
//   can't be worked out, as when GitHub can't be reached after a push, what runs stops, and its
//   checkouts stay.
// - A server answers only about the head it runs on: a view of another head, or the old side, gets
//   the syntax index's answers.
// - A checkout a server finds isn't one its local copy counts as its own any more, as once the
//   local copy was made again, is made again: what runs on the pull request's checkouts stops
//   first, and starts again on the new one. One made again that's no better fails, for "Restart".
// - Once no view of a pull request is followed, its checkouts are forgotten, so the next view of it
//   checks its head out again, and gets a checkout cleanup or a new local copy took meanwhile made
//   again.
//
// Nothing here calls Electron, so it runs under unit tests.

import { GitError, type Oid, type TreeEntry } from '@lo/git';

import { IpcError } from '../../../ipc/contract.ts';
import type { ServerLog, ServerState, Servers } from '../contract.ts';
import { adapterFor, type Adapter } from './adapters.ts';
import type { Serving, NotServing } from './served.ts';
import type { PoolView, Root, ServerPool } from './servers.ts';

/** What servers need of a view's local copy. */
export interface ServingRepo {
  checkout(number: number, head: Oid): Promise<string>;
  hashCheckoutFile(checkout: string, path: Uint8Array): Promise<Oid | undefined>;
  tree(rev: Oid): Promise<TreeEntry[]>;
}

/** A view, as servers follow it. */
export interface ServingInput {
  readonly id: string;
  /** Its repository, `owner/name`, as the tab names it. */
  readonly repo: string;
  readonly number: number;
  /**
   * `trusted`; `checking` while trust is worked out, as after a push, which holds what runs if it
   * was trusted; `none`, decided untrusted; or `unknown`, undecided, as when its repositories
   * couldn't be read, or there's no git: nothing runs, and its checkouts stay.
   */
  readonly trust: 'trusted' | 'checking' | 'none' | 'unknown';
  /** Whether language servers are off on it because nothing trusts it. */
  readonly off: boolean;
  /** The head on screen, once the local copy is ready at it. */
  readonly head: Oid | undefined;
  /** The commits its two sides show, once the local copy has them. */
  readonly sides: { readonly new: Oid; readonly old: Oid | undefined } | undefined;
  readonly clone: () => Promise<ServingRepo> | undefined;
}

export interface ServingOptions {
  readonly pool: Pick<ServerPool, 'sync' | 'shown' | 'find' | 'restart' | 'log'>;
  readonly adapters: () => readonly Adapter[];
  /** View `id` as servers need it, or nothing once it's closed. */
  readonly view: (id: string) => ServingInput | undefined;
  /** The view on screen. */
  readonly onScreen: () => string | undefined;
  readonly publish: (servers: Servers) => void;
  /**
   * Stops what runs on pull request `pull` of `repo`'s checkouts, stopping ones included, and
   * resolves once it has.
   */
  readonly stopOn: (repo: string, pull: number) => Promise<void>;
  /**
   * Stops what runs on pull request `pull` of `repo`'s checkouts, then removes them, as once it's
   * decided untrusted.
   */
  readonly letGo: (repo: string, pull: number) => Promise<void>;
  readonly log: (line: string) => void;
}

interface Followed {
  input: ServingInput;
  /** Its trust as last followed, which a change of lets go of what it held. */
  decided: ServingInput['trust'] | undefined;
  /** Whether it was trusted when last decided, which holds what runs while it's checked again. */
  trusted: boolean;
  /** The servers the files it changes need, by adapter, for the sides they were read at. */
  changes: { readonly sides: string; readonly wants: ReadonlySet<string> } | undefined;
  /** The servers of the files asked about, by adapter. */
  readonly asked: Set<string>;
  sent: string;
}

/** A head's checkout: made, being made, or failed. */
interface Checkout {
  folder: string | undefined;
  failed: string | undefined;
  /**
   * Whether it was made again once a server found the one before it unusable, and hasn't been
   * found usable since.
   */
  remade: boolean;
}

/**
 * What the status bar says, after "Lo couldn't check out this PR's head:", of a checkout made again
 * that a server finds unusable too.
 */
const STILL_UNUSABLE = 'the checkout Lo made again isn’t usable either';

/** The lowercase key servers of `repo` are kept by. */
export function repoKey(repo: string): string {
  return repo.toLowerCase();
}

/** The adapters `adapters` names that read a file the pull request adds or changes on its new side. */
export async function changedLanguages(
  repo: Pick<ServingRepo, 'tree'>,
  sides: { readonly new: Oid; readonly old: Oid | undefined },
  adapters: readonly Adapter[],
): Promise<Set<string>> {
  const wants = new Set<string>();
  if (adapters.length === 0) return wants;
  const ours = await repo.tree(sides.new);
  const theirs = sides.old === undefined ? [] : await repo.tree(sides.old);
  const before = new Map(theirs.map((entry) => [entry.path.toString('latin1'), entry]));
  for (const entry of ours) {
    if (entry.mode !== 'regular' && entry.mode !== 'executable') continue;
    const there = before.get(entry.path.toString('latin1'));
    if (there?.oid === entry.oid && there.mode === entry.mode) continue;
    const match = adapterFor(adapters, entry.path.toString('utf8'));
    if (match) wants.add(match.adapter.id);
  }
  return wants;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ServingViews {
  readonly #options: ServingOptions;
  readonly #views = new Map<string, Followed>();
  /** Each head's checkout, by {@link checkoutKey}. */
  readonly #checkouts = new Map<string, Checkout>();
  /** The changed files' languages being read, by repository and sides. */
  readonly #reading = new Set<string>();
  /** Each pull request's checkouts being let go of, by {@link pullKey}. */
  readonly #dropping = new Map<string, Promise<void>>();
  #stopped = false;

  constructor(options: ServingOptions) {
    this.#options = options;
  }

  /** Follows view `id` as it is now, or lets it go once it's closed. */
  update(id: string): void {
    if (this.#stopped) return;
    const input = this.#options.view(id);
    if (!input) {
      const closed = this.#views.get(id);
      this.#views.delete(id);
      if (closed) this.#forgetUnfollowed(closed.input);
      this.#sync();
      // What another view of its pull request decided holds once this one, trusted, has gone.
      if (closed?.trusted === true) this.#decideAgain(closed.input);
      return;
    }
    let followed = this.#views.get(id);
    if (!followed) {
      followed = {
        input,
        trusted: false,
        decided: undefined,
        changes: undefined,
        asked: new Set(),
        sent: '',
      };
      this.#views.set(id, followed);
    }
    followed.input = input;
    const before = followed.decided;
    followed.decided = input.trust;
    if (input.trust === 'trusted') followed.trusted = true;
    else if (input.trust === 'none' || input.trust === 'unknown') followed.trusted = false;
    if (input.trust === 'none') followed.asked.clear();
    if (input.trust === 'trusted') this.#readChanges(followed);
    this.#checkOut(followed);
    this.#sync();
    // A change to any view's trust, a tab opened again included, is acted on with the others'.
    if (input.trust !== before) this.#decideAgain(input);
  }

  /** Follows every view again, as when git changes. */
  updateAll(): void {
    for (const id of this.#views.keys()) this.update(id);
  }

  /** View `id`'s servers, for the window, or nothing for a view not followed. */
  servers(id: string): Servers | undefined {
    const followed = this.#views.get(id);
    return followed && this.#serversOf(followed);
  }

  /**
   * The server that answers about the file at `path` of view `id`'s new side, at `commit`: one
   * runs only on the head on screen of a view the reader trusts. A file of a language whose server
   * the view didn't need yet starts it, while the view is on screen.
   */
  serverFor(id: string, commit: Oid, path: string): Serving | NotServing | undefined {
    const followed = this.#views.get(id);
    const input = followed?.input;
    if (!followed || !input || input.trust !== 'trusted' || input.head !== commit) return undefined;
    const adapters = this.#options.adapters();
    const adapter = adapterFor(adapters, path)?.adapter;
    if (!adapter) return undefined;
    const name = adapter.name;
    const onScreen = this.#options.onScreen() === id;
    if (!this.#wants(followed).has(adapter.id)) {
      followed.asked.add(adapter.id);
      this.#checkOut(followed);
      this.#sync();
    }
    const checkout = this.#checkouts.get(checkoutKey(input, commit));
    const folder = checkout?.folder;
    if (checkout === undefined || folder === undefined) {
      if (checkout?.failed !== undefined) return { kind: 'failed', name };
      return onScreen ? { kind: 'starting', name } : undefined;
    }
    const found = this.#options.pool.find(repoKey(input.repo), adapter.id, folder);
    switch (found?.kind) {
      case undefined:
        // It runs on another head, or hasn't started: it starts once the view is on screen.
        return onScreen ? { kind: 'starting', name } : undefined;
      case 'starting':
      case 'waiting':
      case 'refused':
      case 'missing':
      case 'failed':
      case 'stopped':
        return { ...found, name };
      case 'ready': {
        const clone = input.clone;
        const remake = () => this.#remake(input, commit, checkout);
        return {
          kind: 'ready',
          name,
          // Each file by its own path: the one asked about may lead to another of the server's.
          languageOf(file) {
            const reads = adapterFor(adapters, file);
            return reads?.adapter.id === adapter.id ? reads.languageId : undefined;
          },
          definitionDeadline: adapter.definitionDeadline,
          referencesFromDefinition: adapter.referencesFromDefinition,
          noHints: adapter.noHints,
          noReferences: adapter.noReferences,
          server: found.server,
          async matches(file, oid) {
            const repo = await clone();
            if (!repo) return false;
            let hashed: Oid | undefined;
            try {
              hashed = await repo.hashCheckoutFile(folder, Buffer.from(file, 'utf8'));
            } catch (error) {
              if (!isNotACheckout(error)) throw error;
              return remake();
            }
            checkout.remade = false;
            return hashed === oid;
          },
        };
      }
      default:
        found satisfies never;
        return undefined;
    }
  }

  /**
   * Starts view `id`'s server `server` again at its head, as "Restart" asks: a checkout that failed
   * is made again first.
   */
  async restart(id: string, server: string): Promise<void> {
    const followed = this.#views.get(id);
    const input = followed?.input;
    if (!followed || !input)
      throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
    if (input.trust !== 'trusted' || input.head === undefined) {
      throw new IpcError('refused', 'Language servers don’t run on this PR.');
    }
    const adapter = this.#options.adapters().find((each) => each.id === server);
    if (!adapter) throw new IpcError('missing', 'There’s no language server by that name.');
    followed.asked.add(adapter.id);
    const head = input.head;
    const key = checkoutKey(input, head);
    const checkout = this.#checkouts.get(key);
    if (checkout?.failed !== undefined) this.#checkouts.delete(key);
    const folder = await this.#checkoutOf(followed, head);
    this.#sync();
    // Trust, or the head, may have changed while it was checked out.
    const now = this.#options.view(id);
    if (folder === undefined || this.#stopped || now?.trust !== 'trusted' || now.head !== head) {
      return;
    }
    const root: Root = { folder, pull: input.number };
    await this.#options.pool.restart(repoKey(input.repo), adapter, root);
  }

  /** View `id`'s server `server`'s log, or nothing when it has none. */
  log(id: string, server: string): ServerLog | null {
    const input = this.#views.get(id)?.input;
    const adapter = this.#options.adapters().find((each) => each.id === server);
    if (!input || !adapter) return null;
    const lines = this.#options.pool.log(repoKey(input.repo), adapter.id);
    return lines ? { name: adapter.name, lines: [...lines] } : null;
  }

  /**
   * Forgets the checkouts of `repo` that `dropped` picks by pull request, once they've been let go
   * of, so a view trusted again checks out afresh.
   */
  forget(repo: string, dropped: (pull: number) => boolean): void {
    for (const key of this.#checkouts.keys()) {
      const [owner, number] = key.split('#');
      if (owner === repoKey(repo) && dropped(Number(number?.split('@')[0]))) {
        this.#checkouts.delete(key);
      }
    }
  }

  /** Says again what each view of `repo` shows of its servers, as when one changed. */
  changed(repo: string): void {
    for (const followed of this.#views.values()) {
      if (repoKey(followed.input.repo) === repo) this.#publish(followed);
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#views.clear();
  }

  /** The servers `followed` needs, by adapter. */
  #wants(followed: Followed): Set<string> {
    return new Set([...(followed.changes?.wants ?? []), ...followed.asked]);
  }

  /** Reads which servers the files `followed` changes need, once for each pair of sides. */
  #readChanges(followed: Followed): void {
    const { input } = followed;
    if (!input.sides) return;
    const sides = `${input.sides.new} ${input.sides.old ?? ''}`;
    if (followed.changes?.sides === sides) return;
    const reading = `${repoKey(input.repo)} ${sides}`;
    if (this.#reading.has(reading)) return;
    this.#reading.add(reading);
    const shown = input.sides;
    const id = input.id;
    void (async () => {
      let wants = new Set<string>();
      try {
        const repo = await input.clone();
        if (repo) wants = await changedLanguages(repo, shown, this.#options.adapters());
      } catch (error) {
        this.#options.log(
          `${input.repo}#${input.number}: couldn't read what it changes (${describe(error)}).`,
        );
      } finally {
        this.#reading.delete(reading);
      }
      const now = this.#views.get(id);
      if (this.#stopped || !now) return;
      const at = now.input.sides;
      if (at && `${at.new} ${at.old ?? ''}` === sides) now.changes = { sides, wants };
      this.update(id);
    })();
  }

  /** Checks out the head of `followed`, once it's trusted, on screen and needs a server. */
  #checkOut(followed: Followed): void {
    const { input } = followed;
    if (input.trust !== 'trusted' || input.head === undefined) return;
    if (this.#options.onScreen() !== input.id || this.#wants(followed).size === 0) return;
    void this.#checkoutOf(followed, input.head);
  }

  /**
   * The folder of `head`'s checkout for `followed`'s pull request, made if it isn't, once its
   * checkouts have been let go of if they're being let go of. One made once nothing trusts the pull
   * request goes at once.
   */
  async #checkoutOf(followed: Followed, head: Oid): Promise<string | undefined> {
    const { input } = followed;
    const key = checkoutKey(input, head);
    const known = this.#checkouts.get(key);
    if (known) return known.folder;
    const dropping = this.#dropping.get(pullKey(input));
    if (dropping) {
      // Once they've gone, views trusted meanwhile check out afresh.
      await dropping;
      return undefined;
    }
    const checkout: Checkout = { folder: undefined, failed: undefined, remade: false };
    this.#checkouts.set(key, checkout);
    return this.#make(input, head, checkout);
  }

  /**
   * Makes `checkout`, of `head` for `input`'s pull request, and returns its folder, unless it was
   * forgotten or replaced meanwhile. One made once nothing trusts the pull request goes at once.
   */
  async #make(input: ServingInput, head: Oid, checkout: Checkout): Promise<string | undefined> {
    const key = checkoutKey(input, head);
    try {
      const repo = await input.clone();
      if (!repo) throw new Error('The pull request’s local copy isn’t open.');
      checkout.folder = await repo.checkout(input.number, head);
    } catch (error) {
      checkout.failed = describe(error);
      this.#options.log(
        `${input.repo}#${input.number}: couldn't check out ${head}: ${checkout.failed}`,
      );
    }
    const current = this.#checkouts.get(key) === checkout;
    if (checkout.folder !== undefined && !this.#trustedNow(input)) {
      // Trust went while it was made: it goes too.
      if (current) this.#checkouts.delete(key);
      this.#letGo(input, true);
      return undefined;
    }
    if (!current) return undefined;
    this.#sync();
    return checkout.folder;
  }

  /**
   * Makes `head`'s checkout for `input`'s pull request again, once a server found `made`, the one it
   * runs on, isn't one its local copy counts as its own, as once the local copy was made again
   * without it. What runs on the pull request's checkouts stops first, so nothing runs on it while
   * it's made, then starts on the new one. One made again that a server finds no better, before
   * it's ever found usable, fails instead, so the status bar says so and "Restart" tries again.
   * Says which it did. A late answer, about a checkout that's since been made again, let go of or
   * no longer trusted, gets what holds now, or `false`, so its note says nothing out of date.
   */
  #remake(input: ServingInput, head: Oid, made: Checkout): 'remaking' | 'unusable' | false {
    const key = checkoutKey(input, head);
    const now = this.#checkouts.get(key);
    if (!this.#trustedNow(input) || this.#dropping.has(pullKey(input))) return false;
    if (now !== made) {
      // Another question found it first.
      if (now === undefined || now.folder !== undefined) return false;
      return now.failed === undefined ? 'remaking' : 'unusable';
    }
    const { repo, number } = input;
    const stopping = () =>
      this.#options.stopOn(repo, number).catch((error: unknown) => {
        this.#options.log(`${repo}#${number}: couldn't stop its servers (${describe(error)}).`);
      });
    if (made.remade) {
      made.folder = undefined;
      made.failed = STILL_UNUSABLE;
      this.#options.log(`${repo}#${number}: its checkout of ${head} made again isn't usable.`);
      this.#sync();
      void stopping();
      return 'unusable';
    }
    const again: Checkout = { folder: undefined, failed: undefined, remade: true };
    this.#checkouts.set(key, again);
    this.#options.log(
      `${repo}#${number}: making its checkout of ${head} again, since it isn't the local copy's.`,
    );
    // With no checkout to run on meanwhile, nothing starts on the old one once what ran there stops.
    this.#sync();
    void (async () => {
      await stopping();
      if (this.#stopped || this.#checkouts.get(key) !== again) return;
      await this.#make(input, head, again);
    })();
    return 'remaking';
  }

  /**
   * Forgets the checkouts of `closed`'s pull request once no view of it is followed, so the next
   * view of it checks its head out again, which makes one that's gone or no longer the local copy's
   * again. What runs on them runs on until the pool stops it, so checking out again, which takes the
   * clone's lock and forces the head's files back as git has them, can happen while a server that
   * ran on the checkout is still stopping, or still runs there: it writes only what git checks out.
   */
  #forgetUnfollowed(closed: Pick<ServingInput, 'repo' | 'number'>): void {
    const key = pullKey(closed);
    for (const followed of this.#views.values()) {
      if (pullKey(followed.input) === key) return;
    }
    for (const each of this.#checkouts.keys()) {
      if (each.startsWith(`${key}@`)) this.#checkouts.delete(each);
    }
  }

  /** Whether a view of `pull`'s pull request is trusted now, or checked again after it was. */
  #trustedNow(pull: Pick<ServingInput, 'repo' | 'number'>): boolean {
    const key = pullKey(pull);
    for (const followed of this.#views.values()) {
      if (pullKey(followed.input) !== key) continue;
      const now = this.#options.view(followed.input.id);
      if (now?.trust === 'trusted' || (now?.trust === 'checking' && followed.trusted)) return true;
    }
    return false;
  }

  /**
   * Acts on what the views of `pull`'s pull request decided, once one of them changes or the one
   * trusted closes: one decided untrusted lets go of what runs on its checkouts, and they go, and
   * else one undecided stops what runs, once no view of it is trusted.
   */
  #decideAgain(pull: Pick<ServingInput, 'repo' | 'number'>): void {
    const key = pullKey(pull);
    const decided = [...this.#views.values()]
      .filter((followed) => pullKey(followed.input) === key)
      .map((followed) => followed.decided);
    if (decided.includes('none')) this.#letGo(pull);
    else if (decided.includes('unknown')) this.#stopOn(pull);
  }

  /** Once no view of `pull`'s pull request is trusted, stops what runs on its checkouts. */
  #stopOn(pull: Pick<ServingInput, 'repo' | 'number'>): void {
    if (this.#stopped || this.#trustedNow(pull)) return;
    const { repo, number } = pull;
    this.#options.stopOn(repo, number).catch((error: unknown) => {
      this.#options.log(`${repo}#${number}: couldn't stop its servers (${describe(error)}).`);
    });
  }

  /**
   * Once no view of `pull`'s pull request is trusted, stops what runs on its checkouts and removes
   * them, then forgets them, so a view trusted again checks out afresh. `again`, for a checkout
   * made meanwhile, lets go once more after a letting go already under way.
   */
  #letGo(pull: Pick<ServingInput, 'repo' | 'number'>, again = false): void {
    if (this.#stopped || this.#trustedNow(pull)) return;
    const key = pullKey(pull);
    const under = this.#dropping.get(key);
    if (under) {
      if (again) void under.then(() => this.#letGo(pull));
      return;
    }
    const { repo, number } = pull;
    const dropping = (async () => {
      try {
        await this.#options.letGo(repo, number);
      } catch (error) {
        this.#options.log(
          `${repo}#${number}: couldn't let go of its checkouts (${describe(error)}).`,
        );
      } finally {
        for (const each of this.#checkouts.keys()) {
          if (each.startsWith(`${key}@`)) this.#checkouts.delete(each);
        }
        this.#dropping.delete(key);
      }
      this.updateAll();
    })();
    this.#dropping.set(key, dropping);
  }

  /** Tells the servers what the views need, and the window what each view shows. */
  #sync(): void {
    if (this.#stopped) return;
    const adapters = this.#options.adapters();
    const views: PoolView[] = [];
    for (const followed of this.#views.values()) {
      const { input } = followed;
      const held = input.trust === 'checking' && followed.trusted;
      if (input.trust !== 'trusted' && !held) continue;
      // Only a trusted view's head is one a server may start on or move to.
      const folder =
        input.trust !== 'trusted' || input.head === undefined
          ? undefined
          : this.#checkouts.get(checkoutKey(input, input.head))?.folder;
      const wants = this.#wants(followed);
      views.push({
        id: input.id,
        repo: repoKey(input.repo),
        pull: input.number,
        trust: input.trust === 'trusted' ? 'trusted' : 'held',
        root: folder === undefined ? undefined : { folder, pull: input.number },
        wants: adapters.filter((adapter) => wants.has(adapter.id)),
      });
    }
    this.#options.pool.sync(views, this.#options.onScreen());
    for (const followed of this.#views.values()) this.#publish(followed);
  }

  #publish(followed: Followed): void {
    const servers = this.#serversOf(followed);
    const sent = JSON.stringify(servers);
    if (sent === followed.sent) return;
    followed.sent = sent;
    this.#options.publish(servers);
  }

  /** What `followed`'s status bar says of its servers. */
  #serversOf(followed: Followed): Servers {
    const { input } = followed;
    const adapters = this.#options.adapters();
    const off = input.off && adapters.length > 0;
    const held = input.trust === 'checking' && followed.trusted;
    if (input.trust !== 'trusted' && !held) return { view: input.id, off, servers: [] };
    const wants = this.#wants(followed);
    const checkout =
      input.head === undefined ? undefined : this.#checkouts.get(checkoutKey(input, input.head));
    const onScreen = this.#options.onScreen() === input.id;
    const servers: Servers['servers'] = [];
    for (const adapter of adapters) {
      if (!wants.has(adapter.id)) continue;
      const shown = this.#options.pool.shown(repoKey(input.repo), adapter.id);
      let state: ServerState | undefined = shown?.state;
      if (checkout?.failed !== undefined && input.trust === 'trusted') {
        state = {
          kind: 'failed',
          why: {
            kind: 'error',
            message: clip(`Lo couldn’t check out this PR’s head: ${checkout.failed}`),
          },
        };
      } else if (state === undefined && onScreen && input.trust === 'trusted') {
        state = { kind: 'starting' };
      }
      if (state === undefined) continue;
      const version = shown?.version === undefined ? {} : { version: shown.version };
      servers.push({ id: adapter.id, name: adapter.name, ...version, state });
    }
    return { view: input.id, off: false, servers };
  }
}

/** Whether `error` says a folder isn't one of its local copy's checkouts. */
function isNotACheckout(error: unknown): boolean {
  return (
    error instanceof GitError && error.detail.kind === 'invalid' && error.detail.what === 'checkout'
  );
}

/** The key a pull request's checkouts are kept by: its repository and number. */
function pullKey(input: Pick<ServingInput, 'repo' | 'number'>): string {
  return `${repoKey(input.repo)}#${input.number}`;
}

/** The key a head's checkout is kept by: its repository, pull request and commit. */
function checkoutKey(input: Pick<ServingInput, 'repo' | 'number'>, head: Oid): string {
  return `${pullKey(input)}@${head}`;
}

/** `text`, cut to what the contract carries. */
function clip(text: string): string {
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}
