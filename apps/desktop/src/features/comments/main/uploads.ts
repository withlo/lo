// Uploading the files attached to comments, in main: the window hands over each file's bytes from
// its own `File`, prepared in the background process, and main never reads a path. Before anything
// is sent, main checks again that the file is a kind GitHub takes, by its name, within that kind's
// size, with first bytes that agree, and that the account can write to the pull request's
// repository, which GitHub's uploads need. The account's poller sends it, one at a time, and says
// how far it has gone. When GitHub answers Not Found though the account can write, as it does when
// it won't take Lo's sign-in for uploads, gh's token for the account is read for that upload alone,
// and it's sent once more with that. Nothing else sends one again: an upload can't be undone.
// Nothing here calls Electron.

import {
  attachmentKind,
  attachmentMarkdown,
  bytesAgree,
  describeRefusal,
  explainUploadError,
  GithubError,
  type Poller,
  type PreparedAttachment,
  RepoRef,
  type Token,
  uploadLimit,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { UploadOutcome, UploadProgressRow, UploadRefusal } from '../contract.ts';

/** What uploads use of an account's poller. */
export type UploadsPoller = Pick<Poller, 'upload' | 'attachmentTarget'>;

export interface UploadsOptions {
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<UploadsPoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => PullTabInfo | undefined;
  /**
   * gh's token for `login`, read afresh for one upload, or nothing when gh has none for it. It
   * throws when gh couldn't be asked.
   */
  readonly ghToken: (login: string) => Promise<Token | undefined>;
  /** Tells the window how far an upload has gone. */
  readonly publish: (progress: UploadProgressRow) => void;
  readonly log: (line: string) => void;
}

/**
 * Checks a file to upload again, as the window prepared it: a kind GitHub takes by its name, not
 * empty, within that kind's limit, and with first bytes that agree. Answers it as the poller sends
 * it, or why it won't go.
 */
export function checkedFile(
  name: string,
  bytes: Uint8Array,
): PreparedAttachment | { refusal: UploadRefusal } {
  const kind = attachmentKind(name);
  const refused = (refusal: Parameters<typeof describeRefusal>[0]) => ({
    refusal: { kind: 'file' as const, why: describeRefusal(refusal) },
  });
  if (kind === undefined) return refused({ reason: 'unsupported' });
  if (bytes.length === 0) return refused({ reason: 'empty' });
  const limit = uploadLimit(kind);
  if (bytes.length > limit) return refused({ reason: 'tooLarge', limit });
  if (!bytesAgree(kind, bytes)) return refused({ reason: 'mislabelled', kind });
  // Its metadata was taken out in the background process, as the window prepared it; the upload
  // sends the bytes as they are.
  return { name, kind, bytes, metadata: { kind: 'asIs' } };
}

/** Whether GitHub answered Not Found, as it does an upload it won't take from a token. */
function notFound(error: unknown): boolean {
  if (!(error instanceof GithubError)) return false;
  const { detail } = error;
  return detail.kind === 'notFound' || (detail.kind === 'api' && detail.status === 404);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `text` ending as a sentence does. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export class Uploads {
  readonly #options: UploadsOptions;
  /** What gives up each upload under way, by its view and the window's name for it. */
  readonly #running = new Map<string, AbortController>();
  #stopped = false;

  constructor(options: UploadsOptions) {
    this.#options = options;
  }

  /**
   * Uploads `bytes`, the file called `name`, attached to a comment on view `id`, which the window
   * calls `upload`, to the view's pull request's repository as its account.
   */
  async upload(
    id: string,
    upload: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<UploadOutcome> {
    const info = this.#options.view(id);
    if (!info) throw new IpcError('missing', "There's no pull request's tab with that id.");
    if (this.#stopped) throw new IpcError('refused', 'Lo is quitting.');
    if (info.run) return { kind: 'refused', refusal: { kind: 'run' } };
    const acting = info.acting;
    if (acting?.kind !== 'account') return { kind: 'refused', refusal: { kind: 'signIn' } };
    const file = checkedFile(name, bytes);
    if ('refusal' in file) return { kind: 'refused', refusal: file.refusal };
    const key = `${id}|${upload}`;
    if (this.#running.has(key)) throw new IpcError('refused', 'That upload is under way already.');
    const giveUp = new AbortController();
    this.#running.set(key, giveUp);
    try {
      return await this.#send(id, upload, acting.login, info, file, giveUp.signal);
    } finally {
      this.#running.delete(key);
    }
  }

  /** Gives up view `id`'s upload `upload`, if it's under way. */
  cancel(id: string, upload: string): void {
    this.#running.get(`${id}|${upload}`)?.abort(new DOMException('cancelled', 'AbortError'));
  }

  /** Gives up every upload under way, and takes no more, as Lo quits. */
  stop(): void {
    this.#stopped = true;
    for (const giveUp of this.#running.values()) {
      giveUp.abort(new DOMException('Lo is quitting', 'AbortError'));
    }
  }

  async #send(
    id: string,
    upload: string,
    login: string,
    info: PullTabInfo,
    file: PreparedAttachment,
    signal: AbortSignal,
  ): Promise<UploadOutcome> {
    const { owner, name } = info.repository;
    const repo = new RepoRef(owner, name);
    const progress = (sent: number, total: number) => {
      this.#options.publish({ id, upload, sent, total });
    };
    try {
      const poller = await this.#options.poller(login);
      const target = await poller.attachmentTarget(repo, signal);
      if (target.canWrite === false) {
        return { kind: 'refused', refusal: { kind: 'cantWrite', repo: name } };
      }
      const first = await poller
        .upload(repo, file, { signal, progress })
        .catch((error: unknown) => {
          // GitHub took nothing, and the account can write: Lo's sign-in is what it won't take.
          if (!notFound(error) || target.canWrite !== true || signal.aborted) throw error;
          return undefined;
        });
      if (first !== undefined) return this.#outcome(file, first, false);
      // Asked for once, for this upload alone, and never kept.
      let token: Token | undefined;
      try {
        token = await this.#options.ghToken(login);
      } catch (error) {
        if (signal.aborted) return { kind: 'cancelled' };
        const why = sentence(describe(error));
        return {
          kind: 'failed',
          message: `GitHub took no upload with Lo’s sign-in, and Lo couldn’t read gh’s: ${why}`,
        };
      }
      if (token === undefined) return { kind: 'refused', refusal: { kind: 'needsGh' } };
      signal.throwIfAborted();
      const second = await poller.upload(repo, file, { signal, progress, token });
      return this.#outcome(file, second, true);
    } catch (error) {
      if (signal.aborted) return { kind: 'cancelled' };
      if (error instanceof GithubError) {
        return { kind: 'failed', message: sentence(explainUploadError(error, `${owner}/${name}`)) };
      }
      this.#options.log(`uploading a file: ${describe(error)}`);
      return { kind: 'failed', message: `Lo couldn’t upload it: ${sentence(describe(error))}` };
    }
  }

  #outcome(
    file: PreparedAttachment,
    answer: Awaited<ReturnType<UploadsPoller['upload']>>,
    viaGh: boolean,
  ): UploadOutcome {
    if (typeof answer !== 'string') {
      return { kind: 'refused', refusal: { kind: 'paused', until: answer.until } };
    }
    return { kind: 'uploaded', markdown: attachmentMarkdown(file.kind, file.name, answer), viaGh };
  }
}
