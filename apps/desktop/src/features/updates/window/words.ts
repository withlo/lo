// What the update toasts say that depends on numbers: how far a download has come.

import { formatBytes } from '@lo/ui';

/**
 * What names a build beside its version, as Settings says it: `Built from source` for a build run
 * from source, which has no release to name, else the commit a packaged Lo was built from. Nothing
 * for a packaged Lo built where no commit could be found.
 */
export function buildText(info: {
  packaged: boolean;
  commit?: string | undefined;
}): string | undefined {
  if (!info.packaged) return 'Built from source';
  return info.commit === undefined ? undefined : `Commit ${info.commit}`;
}

/**
 * How much of a download has come, as the toast says it: `38 of 112 MB`, with the unit said once
 * when both sizes share it, and `38 MB` while GitHub hasn't said how large it is, which a total of
 * 0 means. Nothing has come yet: `Starting`.
 */
export function progressText(received: number, total: number): string {
  if (received <= 0) return 'Starting';
  const done = formatBytes(received);
  if (total <= 0) return done;
  const whole = formatBytes(total);
  const [number, unit] = done.split(' ');
  return unit === whole.split(' ')[1] ? `${number} of ${whole}` : `${done} of ${whole}`;
}
