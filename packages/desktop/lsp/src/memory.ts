/**
 * The resident memory of process groups: each server's own, with everything it started. On Linux
 * it's read from `/proc`; elsewhere, on macOS, from `ps`.
 */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

/** How many of `/proc`'s files are read at once. */
const READS_AT_ONCE = 64;

/**
 * The resident memory of each of `groups`, in bytes: the sum over every process in the group. A
 * group with no process left is missing from the answer.
 */
export async function groupMemory(
  groups: readonly number[],
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, number>> {
  const wanted = new Set(groups);
  if (wanted.size === 0) return new Map();
  return platform === 'linux' ? fromProc(wanted) : fromPs(wanted);
}

/** Reads every process's group from `/proc/<pid>/stat`, and a member's memory from its `status`. */
async function fromProc(groups: ReadonlySet<number>): Promise<Map<number, number>> {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const memory = new Map<number, number>();
  for (let start = 0; start < pids.length; start += READS_AT_ONCE) {
    await Promise.all(
      pids.slice(start, start + READS_AT_ONCE).map(async (pid) => {
        try {
          const group = groupOfStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
          if (group === undefined || !groups.has(group)) return;
          const resident = residentOfStatus(await readFile(`/proc/${pid}/status`, 'utf8'));
          if (resident !== undefined) memory.set(group, (memory.get(group) ?? 0) + resident);
        } catch {
          // The process ended while it was read.
        }
      }),
    );
  }
  return memory;
}

/** The process group in a `/proc/<pid>/stat` line, whose name may hold spaces and parentheses. */
export function groupOfStat(stat: string): number | undefined {
  // After the name's closing parenthesis: state, parent, group.
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  const group = Number(fields[2]);
  return Number.isSafeInteger(group) && group > 0 ? group : undefined;
}

/** The resident memory in a `/proc/<pid>/status` file, in bytes. A zombie has none. */
export function residentOfStatus(status: string): number | undefined {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  return match ? Number(match[1]) * 1024 : undefined;
}

/** Reads every process's group and resident memory from one run of `ps`. */
async function fromPs(groups: ReadonlySet<number>): Promise<Map<number, number>> {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', 'pgid=,rss='], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 4000,
  });
  return memoryOfPs(stdout, groups);
}

/** Sums `ps -o pgid=,rss=`'s lines by group, for `groups`, in bytes. */
export function memoryOfPs(output: string, groups: ReadonlySet<number>): Map<number, number> {
  const memory = new Map<number, number>();
  for (const line of output.split('\n')) {
    const [group, resident] = line.trim().split(/\s+/).map(Number);
    if (group === undefined || resident === undefined || !groups.has(group)) continue;
    if (!Number.isSafeInteger(resident)) continue;
    memory.set(group, (memory.get(group) ?? 0) + resident * 1024);
  }
  return memory;
}
