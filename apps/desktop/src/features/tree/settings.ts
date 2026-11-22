// The tree's setting: how the left panel lists a pull request's files. `t` switches it from the
// files, and Settings shows it.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * How the files are listed: as a tree, or only the changed files, in the order they're best read
 * in. It's the window's, for every pull request, and kept across a restart.
 */
export const mode = defineSetting(
  'tree.mode',
  z.enum(['tree', 'review']),
  'tree',
  'tree or review',
  {
    group: 'pullRequests',
    label: 'Files',
    description: 'How the left panel lists a pull request’s files.',
    options: { tree: 'Tree', review: 'Review order' },
  },
);
