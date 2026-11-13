// The comments feature in main: the images in posts, and avatars, which the window loads only on
// the image scheme, served here from GitHub's image hosts (`./images.ts`). An image in a post is
// fetched, and kept, as the account its pull request's tab acts as, whose token goes only to
// GitHub's address for an attachment.

import { app, net, session } from 'electron';

import { readImageAddress } from '../../../ipc/images.ts';
import { githubSettings } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { netFetch } from '../../../main/fetch.ts';
import { windowPartition } from '../../../main/policy.ts';
import { serveImages, type ServedImage } from '../../../main/security.ts';
import { github } from '../../accounts/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { IMAGE_LIMITS, ImageError, Images } from './images.ts';

/**
 * Images come through Chromium's network stack in main's own session, as requests to GitHub do,
 * keeping nothing in Chromium's cache and no cookie, and reading no more of an answer than an image
 * may be.
 */
const fetch = netFetch((options) => net.request(options), { limit: IMAGE_LIMITS.bytes });

const log = (line: string) => console.error(`comments: ${line}`);

let stopServing: (() => void) | undefined;

export default defineFeature(contract, {
  uses: [github, tabs],
  handlers: {},
  start({ use }) {
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
    stopServing?.();
    stopServing = undefined;
  },
});
