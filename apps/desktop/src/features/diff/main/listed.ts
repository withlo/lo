// Which head GitHub listed a pull request's files at. Nothing here calls Electron.

import { fileHead, type PullFile } from '@lo/github';

/**
 * Whether GitHub listed `files` at `head`: their links name the head they were listed at, and the
 * list is of GitHub's newest head, which can be past the one on screen. A list whose links don't
 * say, as when every file was removed, is taken as `head`'s.
 */
export function listedAt(files: readonly PullFile[], head: string): boolean {
  return files.every((file) => {
    const at = fileHead(file);
    return at === undefined || at === head;
  });
}
