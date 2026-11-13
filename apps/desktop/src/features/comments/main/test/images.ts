/**
 * The images the app's tests load, recorded as `rozed-bot` with main's own image loader, so the
 * cassette holds what the app asks for: a 2x2 PNG attached in rozed-dev/e2e, by its address on
 * github.com, which takes the token, and the signed address that redirects to, which doesn't; and
 * rozed-bot's avatar. Nothing here writes to GitHub.
 *
 *   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> \
 *     node testing/scripts/record.ts apps/desktop/src/features/comments/main/test/images.ts
 */

import { Token } from '@lo/github';
import type { Scenario } from '@lo/testing';

import { Images } from '../images.ts';

/** A 2x2 PNG attached in rozed-dev/e2e. */
export const ATTACHMENT =
  'https://github.com/user-attachments/assets/08c730b3-f0b0-4c7d-93a2-95f8d167d0d9';

/** rozed-bot's avatar, as the window asks for one drawn 28 pixels a side. */
export const AVATAR = { login: 'rozed-bot', size: 56 } as const;

/** The recordings `node testing/scripts/record.ts` makes from this module. */
export const scenarios: Scenario[] = [
  {
    name: 'images_e2e',
    description:
      "Images as main loads them, as rozed-bot: a 2x2 PNG attached in rozed-dev/e2e, by its address on github.com and the signed address it redirects to, and rozed-bot's avatar, 56 pixels a side",
    repo: 'rozed-dev/e2e',
    async run(fetch, token) {
      const images = new Images({ fetch, token: () => Promise.resolve(new Token(token)) });
      await images.load({ kind: 'post', view: 'recording', address: ATTACHMENT });
      await images.load({ kind: 'avatar', ...AVATAR });
      return undefined;
    },
  },
];
