/** How a file's diff starts out when the pull request opens. */

import { changedLines, type ChangedFile } from './changed.ts';
import { whyGenerated, type Generated } from './generated.ts';

/** Files with more changed lines than this start collapsed, and their diff loads on a key. */
export const LARGE_FILE_LINES = 5_000;

/**
 * Files larger than this on either side start collapsed too, and load on a key: a minified bundle
 * or generated data can be megabytes in a few lines.
 */
export const LARGE_FILE_BYTES = 1024 * 1024;

/** How a file's diff starts out. */
export interface InitialState {
  /** Why the file is generated, if it is. Generated files start collapsed. */
  readonly generated: Generated | undefined;
  /**
   * The file has more than {@link LARGE_FILE_LINES} changed lines, or is larger than
   * {@link LARGE_FILE_BYTES} on either side. It starts collapsed, and its diff loads only on a key.
   */
  readonly large: boolean;
  /**
   * The file is binary, so it has no text diff: images show before and after, and anything else
   * shows as "binary file changed".
   */
  readonly binary: boolean;
}

/** Whether the file starts collapsed: it's generated, large or both. */
export function startsCollapsed(state: InitialState): boolean {
  return state.generated !== undefined || state.large;
}

/** How the file's diff starts out. */
export function initialState(file: ChangedFile): InitialState {
  return {
    generated: whyGenerated(file),
    large:
      changedLines(file) > LARGE_FILE_LINES ||
      (file.size !== undefined && file.size > LARGE_FILE_BYTES),
    binary: file.binary,
  };
}
