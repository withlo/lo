// The comments feature in main: each view's review threads and your pending review, read for the
// view on screen and sent to the window as they change (`./threads.ts`); the comments the reader
// writes, kept as drafts until they're sent, and sent one at a time to a pull request
// (`./writer.ts`), with which lines GitHub takes them on (`./commentable.ts`); posts' HTML, read on
// demand as the window asks for the posts on screen, and offered to the other features as
// `comments.bodies`; the threads, your pending review and a turn among the writes, offered as
// `comments.reviews`, and the submit dialog's summary, kept with the drafts and offered as
// `comments.drafts` (`./summary.ts`), for submitting a review; and the images in posts, and
// avatars, which the window loads only on the image scheme, served here from GitHub's image hosts
// (`./images.ts`). An image in a post is fetched, and kept, as the account its pull request's tab
// acts as, whose token goes only to GitHub's address for an attachment. And the files attached to
// comments, uploaded as the window hands them over (`./uploads.ts`).

import { parseOid } from '@lo/git';
import { attachmentTarget } from '@lo/github';
import { app, net, session } from 'electron';

import { readImageAddress } from '../../../ipc/images.ts';
import { githubSettings } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { netFetch } from '../../../main/fetch.ts';
import { windowPartition } from '../../../main/policy.ts';
import { serveImages, type ServedImage } from '../../../main/security.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { comparisons } from '../../revisions/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { bodies, drafts, reviews } from '../service.ts';
import { readBodies } from './bodies.ts';
import { CommentableReads } from './commentable.ts';
import { DraftStore } from './drafts.ts';
import { IMAGE_LIMITS, ImageError, Images } from './images.ts';
import { summaries } from './summary.ts';
import { ThreadReads } from './threads.ts';
import { Uploads } from './uploads.ts';
import { Writer } from './writer.ts';

/**
 * Images come through Chromium's network stack in main's own session, as requests to GitHub do,
 * keeping nothing in Chromium's cache and no cookie, and reading no more of an answer than an image
 * may be.
 */
const fetch = netFetch((options) => net.request(options), { limit: IMAGE_LIMITS.bytes });

const log = (line: string) => console.error(`comments: ${line}`);

let stopServing: (() => void) | undefined;
let reads: ThreadReads | undefined;
let writer: Writer | undefined;
let commentable: CommentableReads | undefined;
let store: DraftStore | undefined;
let uploads: Uploads | undefined;
const stops: (() => void)[] = [];

/** What `start` made, for a handler: the window asks nothing before main has started. */
function started<T>(made: T | undefined): T {
  if (made === undefined) throw new Error('The comments feature hasn’t started.');
  return made;
}

export default defineFeature(contract, {
  uses: [github, tabs, comparisons],
  provide: (context) => [
    provides(bodies, {
      read: (id, posts, options) =>
        readBodies(
          {
            pull: (view) => context.use(tabs).pull(view),
            poller: (login) => context.use(github).poller(login),
          },
          id,
          posts,
          options,
        ),
    }),
    // For the submit dialog: your pending review, a turn among the writes, and its summary.
    provides(reviews, {
      current: (id) => reads?.current(id) ?? { threads: undefined, review: undefined },
      inTurn: (id, write) => started(writer).inTurn(id, write),
    }),
    provides(
      drafts,
      summaries(() => started(store)),
    ),
  ],
  handlers: {
    async bodies({ id, posts, description }, { use }) {
      const read = await use(bodies).read(id, posts, { description });
      return {
        description: read.description ?? null,
        posts: [...read.bodies].map(([post, html]) => ({ id: post, html })),
        gone: read.gone,
      };
    },
    current: ({ id }) => ({
      ...(reads?.current(id) ?? { threads: undefined, review: undefined }),
      drafts: writer?.draftsOf(id),
    }),
    draft({ id, place, text }) {
      started(writer).save(id, place, text);
    },
    discard({ id, place }) {
      started(writer).discard(id, place);
    },
    commentable: ({ id, commit, path, previous }) =>
      started(commentable).read(id, commit, path, previous),
    send: ({ id, place, text, how }) => started(writer).send(id, place, text, how),
    attachable: ({ id }) => started(uploads).check(id),
    upload: ({ id, upload, name, bytes }) => started(uploads).upload(id, upload, name, bytes),
    cancelUpload({ id, upload }) {
      started(uploads).cancel(id, upload);
    },
    editing: ({ id, place, base }) => started(writer).editing(id, place, base),
    edit: ({ id, place, text }) => started(writer).edit(id, place, text),
    resolve: ({ id, thread, resolved }) => started(writer).resolve(id, thread, resolved),
    remove: ({ id, thread, comment, asked }) => started(writer).remove(id, thread, comment, asked),
  },
  start({ use, publish, database }) {
    const service = use(tabs);
    const kept = new DraftStore(database);
    store = kept;
    const writing = new Writer({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      drafts: kept,
      publish: (view) => publish('drafts', view),
      publishActs: (view) => publish('acts', view),
      async unchanged(id, from, to, path) {
        const repo = await service.clone(id);
        if (!repo) return false;
        const patch = await repo.patch(
          parseOid(from),
          parseOid(to),
          new TextEncoder().encode(path),
        );
        return !patch.binary && patch.hunks.length === 0;
      },
      log: (line) => log(`writing: ${line}`),
    });
    writer = writing;
    uploads = new Uploads({
      poller: (login) => use(github).poller(login),
      target: async (login, repo) => attachmentTarget(await use(github).client(login), repo),
      view: (id) => service.pull(id),
      ghToken: (login) => use(github).ghToken(login),
      publish: (progress) => publish('uploads', progress),
      log: (line) => log(`uploading: ${line}`),
    });
    commentable = new CommentableReads({
      view: (id) => service.pull(id),
      poller: (login) => use(github).poller(login),
      clone: (id) => service.clone(id),
      comparing(id) {
        const on = use(comparisons).onScreen(id);
        return on.kind === 'revisions' ? on.comparing.new : undefined;
      },
      log: (line) => log(`commentable lines: ${line}`),
    });
    const threads = new ThreadReads({
      poller: (login) => use(github).poller(login),
      view: (id) => service.pull(id),
      onScreen: () => service.list().active,
      compared(id) {
        const on = use(comparisons).onScreen(id);
        if (on.kind !== 'revisions') return null;
        const { key, old, new: now } = on.comparing;
        // A revision compared from the base starts where it branched off.
        const from = old.head === now.base ? null : old.head;
        return { key, from, replayed: old.base !== now.base };
      },
      publishThreads: (view) => publish('threads', view),
      publishReview: (view) => publish('review', view),
      log: (line) => log(`threads: ${line}`),
    });
    reads = threads;
    const followWriting = (id: string) => {
      writing.follow(id);
      void writing.headShown(id);
    };
    stops.push(
      service.onPull((id) => {
        threads.follow(id);
        followWriting(id);
      }),
      service.onTabs(() => commentable?.forgetClosed()),
      use(github).onEvent((event) => {
        if (event.kind === 'removed') writing.forget(event.login);
      }),
      // The view shown reads its threads, the first time it's on screen.
      service.onTabs(({ active }) => {
        if (active !== undefined) threads.follow(active);
      }),
      use(comparisons).onChange((id) => threads.compared(id)),
    );
    for (const tab of service.list().tabs) {
      if (tab.kind !== 'pull') continue;
      threads.follow(tab.id);
      followWriting(tab.id);
    }
    // In a test run, GitHub's image hosts are the test's server, as GitHub itself is. A packaged
    // build always fetches from the hosts.
    const { images: stand } = githubSettings({ packaged: app.isPackaged, env: process.env });
    const images = new Images({
      fetch,
      route: (address) =>
        stand === undefined
          ? address.href
          : `${stand}/${address.host}${address.pathname}${address.search}`,
      acting(view) {
        const acting = use(tabs).pull(view)?.acting;
        return acting?.kind === 'account' ? acting.login : undefined;
      },
      async token(login) {
        return (await use(github).client(login)).token;
      },
    });
    stopServing = serveImages(
      session.fromPartition(windowPartition),
      async (address): Promise<ServedImage | undefined> => {
        const asked = readImageAddress(address);
        if (asked === undefined) return undefined;
        try {
          return await images.load(asked);
        } catch (error) {
          // An image error names a host at most; anything else is Lo's own mistake.
          const why = error instanceof ImageError ? error.message : String(error);
          const what = asked.kind === 'post' ? 'an image' : `${asked.login}'s avatar`;
          log(`${what} wasn't shown: ${why}`);
          return undefined;
        }
      },
    );
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    reads?.stop();
    reads = undefined;
    writer?.stop();
    writer = undefined;
    store = undefined;
    uploads?.stop();
    uploads = undefined;
    commentable = undefined;
    stopServing?.();
    stopServing = undefined;
  },
});
