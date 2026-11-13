// The comments feature in main: posts' HTML, read on demand as the window asks for the posts on
// screen, and offered to the other features as `comments.bodies`.

import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { github } from '../../accounts/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { bodies } from '../service.ts';
import { readBodies } from './bodies.ts';

export default defineFeature(contract, {
  uses: [tabs, github],
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
  },
});
