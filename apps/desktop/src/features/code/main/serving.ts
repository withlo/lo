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
//   before, and no other view of it is trusted, what runs on its checkouts stops and they go: one
//   finished after that goes as it's made. While its trust can't be worked out, as when GitHub
//   can't be reached after a push, what runs stops, and its checkouts stay.
// - A server answers only about the head it runs on: a view of another head, or the old side, gets
//   the syntax index's answers.
// - A server whose license the reader hasn't accepted is shown as waiting for it, and its
//   language's answers come from the syntax index, saying so: nothing is checked out, downloaded
//   or started for it until the reader accepts it.
//
// Nothing here calls Electron, so it runs under unit tests.

import type { Oid, TreeEntry } from '@lo/git';

import { IpcError } from '../../../ipc/contract.ts';
import type { ServerLog, ServerState, Servers } from '../contract.ts';
import { adapterFor, type Adapter } from './adapters.ts';
import type { Serving, NotServing } from './served.ts';
import type { NoticeAct, PoolView, Root, ServerPool } from './servers.ts';

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
  readonly pool: Pick<
    ServerPool,
    'sync' | 'shown' | 'find' | 'restart' | 'log' | 'notices' | 'act'
  >;
  readonly adapters: () => readonly Adapter[];
  /**
   * Whether `adapter`'s server may download and start: its license, if it has one, is accepted.
   * Without it, only a server with no license may.
   */
  readonly accepted?: ((adapter: Adapter) => boolean) | undefined;
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
}

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

/** What a language's answers say while its server's license waits for the reader to accept it. */
export function licenseWaits(adapter: Adapter): string | undefined {
  const { license } = adapter;
  if (!license) return undefined;
  return `${adapter.name}'s server, ${license.serverName}, has its own license. Read it and accept it to use it.`;
}

export class ServingViews {
  readonly #options: ServingOptions;

  /** Whether `adapter`'s server may download and start. */
  #accepted(adapter: Adapter): boolean {
    const { accepted } = this.#options;
    return accepted ? accepted(adapter) : adapter.license === undefined;
  }
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
      this.#views.delete(id);
      this.#sync();
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
    if (input.trust === before) return;
    // Decided untrusted, whatever it was before, a tab opened again included: what runs on its
    // checkouts stops, and they go. Undecided, what runs stops.
    if (input.trust === 'none') this.#letGo(input);
    else if (input.trust === 'unknown') this.#stopOn(input);
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
    const match = adapterFor(this.#options.adapters(), path);
    if (!match) return undefined;
    const { adapter, languageId } = match;
    const name = adapter.name;
    const onScreen = this.#options.onScreen() === id;
    const waits = this.#accepted(adapter) ? undefined : licenseWaits(adapter);
    if (!this.#wants(followed).has(adapter.id)) {
      followed.asked.add(adapter.id);
      this.#checkOut(followed);
      this.#sync();
    }
    // Its item shows its license; the syntax index answers, saying why.
    if (waits !== undefined) return { kind: 'license', name, why: waits };
    const checkout = this.#checkouts.get(checkoutKey(input, commit));
    const folder = checkout?.folder;
    if (folder === undefined) {
      if (checkout?.failed !== undefined) return { kind: 'failed', name };
      return onScreen ? { kind: 'starting', name } : undefined;
    }
    const found = this.#options.pool.find(repoKey(input.repo), adapter.id, folder);
    switch (found?.kind) {
      case undefined:
        // It runs on another head, or hasn't started: it starts once the view is on screen.
        return onScreen ? { kind: 'starting', name } : undefined;
      case 'starting':
      case 'failed':
        return { kind: found.kind, name };
      case 'ready': {
        const clone = input.clone;
        return {
          kind: 'ready',
          name,
          languageId,
          definitionDeadline: adapter.definitionDeadline,
          hints: adapter.hints !== false,
          server: found.server,
          async matches(file, oid) {
            const repo = await clone();
            if (!repo) return false;
            const hashed = await repo.hashCheckoutFile(folder, Buffer.from(file, 'utf8'));
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
      throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (input.trust !== 'trusted' || input.head === undefined) {
      throw new IpcError('refused', "Language servers don't run on this PR.");
    }
    const adapter = this.#options.adapters().find((each) => each.id === server);
    if (!adapter) throw new IpcError('missing', "There's no language server by that name.");
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
   * Does what the reader asked with notice `notice` of view `id`'s server `server`, and returns the
   * page to open for `open`.
   */
  notice(id: string, server: string, notice: number, act: NoticeAct): string | undefined {
    const input = this.#views.get(id)?.input;
    if (!input) throw new IpcError('missing', "There's no pull request's tab with that id.");
    return this.#options.pool.act(repoKey(input.repo), server, notice, act);
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

  /** The servers `followed` needs that may run: those whose license, if they have one, is accepted. */
  #runs(followed: Followed): Adapter[] {
    const wants = this.#wants(followed);
    return this.#options
      .adapters()
      .filter((adapter) => wants.has(adapter.id) && this.#accepted(adapter));
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
    if (this.#options.onScreen() !== input.id || this.#runs(followed).length === 0) return;
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
    const checkout: Checkout = { folder: undefined, failed: undefined };
    this.#checkouts.set(key, checkout);
    try {
      const repo = await input.clone();
      if (!repo) throw new Error("The pull request's local copy isn't open.");
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
      views.push({
        id: input.id,
        repo: repoKey(input.repo),
        pull: input.number,
        trust: input.trust === 'trusted' ? 'trusted' : 'held',
        root: folder === undefined ? undefined : { folder, pull: input.number },
        wants: this.#runs(followed),
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
      const repo = repoKey(input.repo);
      const shown = this.#options.pool.shown(repo, adapter.id);
      let state: ServerState | undefined = shown?.state;
      const { license } = adapter;
      if (license && !this.#accepted(adapter)) {
        state = { kind: 'license', server: license.serverName, license: license.name };
      } else if (checkout?.failed !== undefined && input.trust === 'trusted') {
        state = {
          kind: 'failed',
          why: {
            kind: 'error',
            message: clip(`Lo couldn't check out this PR's head: ${checkout.failed}`),
          },
        };
      } else if (state === undefined && onScreen && input.trust === 'trusted') {
        state = { kind: 'starting' };
      }
      if (state === undefined) continue;
      const version = shown?.version ?? adapter.about;
      const notices = adapter.shows ? this.#options.pool.notices(repo, adapter.id) : [];
      servers.push({
        id: adapter.id,
        name: adapter.name,
        ...(version === undefined ? {} : { version }),
        state,
        ...(adapter.hints === false ? { hints: false as const } : {}),
        ...(notices.length > 0 ? { notices } : {}),
      });
    }
    return { view: input.id, off: false, servers };
  }
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
