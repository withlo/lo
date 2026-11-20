// What the update toasts say that depends on numbers: how far a download has come.

import { formatBytes } from '@lo/ui';

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
