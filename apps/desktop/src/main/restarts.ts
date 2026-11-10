/** How long to wait before starting the background process again after its `attempt`th exit. */
export function restartDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt);
}

/**
 * The attempt count after an exit: one more, or back to the first if the process had run long
 * enough to count as healthy.
 */
export function nextAttempt(attempt: number, ranFor: number): number {
  return ranFor >= 60_000 ? 0 : attempt + 1;
}

/** Whether a process's working set, in kilobytes as Electron reports it, is past `cap` bytes. */
export function pastCap(workingSetKilobytes: number, cap: number): boolean {
  return workingSetKilobytes * 1024 > cap;
}
