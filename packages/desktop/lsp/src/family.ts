/**
 * A server's family: every process in its process group, and every process descended from one of
 * them wherever its group, such as a build daemon that made a session of its own. Lo sums the
 * family's resident memory against the server's cap, and stops the whole family.
 *
 * A process is found by its parent, so one that outlives the process that started it is no longer
 * found once that's gone. A stop reads the family while the server shuts down, before it exits,
 * and a kill freezes the group before it reads; what a server that crashed left behind is found no
 * longer. Processes are read from `/proc` on Linux, and from `ps` elsewhere, on macOS.
 */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

/** How many of `/proc`'s files are read at once. */
const READS_AT_ONCE = 64;

/** A running process. */
export interface Member {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  /** Its resident memory, in bytes, once read. */
  readonly resident?: number | undefined;
}

/** Reads the family of the group `group`: the processes in it and descended from them. */
export type ReadFamily = (group: number) => Promise<readonly Member[]>;

/** The family of the group `group`, with each member's resident memory. */
export const readFamily: ReadFamily = async (group) => {
  if (process.platform !== 'linux') return familyOf(await fromPs(), group);
  const members = familyOf(await fromProc(), group);
  return Promise.all(
    members.map(async (member) => {
      try {
        const status = await readFile(`/proc/${member.pid}/status`, 'utf8');
        return { ...member, resident: residentOfStatus(status) };
      } catch {
        // It ended while it was read.
        return member;
      }
    }),
  );
};

/** The members of `table` in the group `group`, and every process descended from one of them. */
export function familyOf(table: readonly Member[], group: number): Member[] {
  const children = new Map<number, Member[]>();
  for (const member of table) {
    const siblings = children.get(member.parent);
    if (siblings === undefined) children.set(member.parent, [member]);
    else siblings.push(member);
  }
  const family = new Map<number, Member>();
  const waiting = table.filter((member) => member.group === group);
  for (let member = waiting.pop(); member !== undefined; member = waiting.pop()) {
    if (family.has(member.pid)) continue;
    family.set(member.pid, member);
    waiting.push(...(children.get(member.pid) ?? []));
  }
  return [...family.values()];
}

/** Every process but a zombie, from its `/proc/<pid>/stat`. */
async function fromProc(): Promise<Member[]> {
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const table: Member[] = [];
  for (let start = 0; start < pids.length; start += READS_AT_ONCE) {
    await Promise.all(
      pids.slice(start, start + READS_AT_ONCE).map(async (pid) => {
        try {
          const member = memberOfStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
          if (member !== undefined) table.push(member);
        } catch {
          // It ended while it was read.
        }
      }),
    );
  }
  return table;
}

/** The process a `/proc/<pid>/stat` line describes, unless it's a zombie. Its name may hold spaces and parentheses. */
export function memberOfStat(stat: string): Member | undefined {
  const pid = Number(stat.slice(0, stat.indexOf(' ')));
  // After the name's closing parenthesis: state, parent, group.
  const [state, parent, group] = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  const member = { pid, parent: Number(parent), group: Number(group) };
  if (state === 'Z' || ![member.pid, member.parent, member.group].every(Number.isSafeInteger)) {
    return undefined;
  }
  return member;
}

/** The resident memory in a `/proc/<pid>/status` file, in bytes. */
export function residentOfStatus(status: string): number | undefined {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  return match ? Number(match[1]) * 1024 : undefined;
}

/** Every process, with its resident memory, from one run of `ps`. */
async function fromPs(): Promise<Member[]> {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss='], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 2000,
  });
  return membersOfPs(stdout);
}

/** The processes in `ps -o pid=,ppid=,pgid=,rss=`'s lines, with their memory in bytes. */
export function membersOfPs(output: string): Member[] {
  const table: Member[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/).map(Number);
    const [pid, parent, group, resident] = fields;
    if (fields.length !== 4 || !fields.every(Number.isSafeInteger)) continue;
    if (pid === undefined || parent === undefined || group === undefined) continue;
    table.push({ pid, parent, group, resident: (resident ?? 0) * 1024 });
  }
  return table;
}
