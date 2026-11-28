/**
 * The overview workflow, as the installer writes it into a repository: its text built into the
 * checker, with the checker it runs pinned to this package's version, as the skill's is.
 */

import template from '../workflow/lo-overview.yml?raw';

import { PINNED, UNPINNED } from './skill.ts';

/** Where the workflow goes in a repository. */
export const WORKFLOW_PATH = '.github/workflows/lo-overview.yml';

/** The workflow's text, running the checker by its exact version. */
export const WORKFLOW_TEXT: string = template.replaceAll(UNPINNED, PINNED);
