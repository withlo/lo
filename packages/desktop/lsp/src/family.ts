/**
 * A server's family: every process in its process group, and every process descended from one of
 * them wherever its group, such as a build daemon that made a session of its own. Lo sums the
 * family's resident memory against the server's cap, and stops the whole family.
 *
 * A process is found by its parent, so one that outlives the process that started it is no longer
 * found by it. A process read before can be named again, and is found while it's the same process:
 * the same ID, started at the same time. Processes are read from `/proc` on Linux, and from `ps`
 * elsewhere, on macOS. The package's README says what can't be found.
 *
 * A server's services are in its family too: processes the system starts for it, outside its
 * family, such as the `SourceKitService` that `launchd` starts for SourceKit-LSP. Each is found by
 * its program's name and by its `HOME`, which is the server's own home only in a process the
 * server's environment reached ({@link servicesOf}).
 */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
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
  /** When it started, as the system says, which tells it from a later process with its ID. */
  readonly started?: string | undefined;
}

/**
 * Reads the family of the group `group`: the processes in it and descended from them. Each of
 * `also`, read before, is in it too, with what descends from it, while it's the same process.
 */
export type ReadFamily = (group: number, also?: readonly Member[]) => Promise<readonly Member[]>;

/**
 * Each of `members`, read before, that's still the same process, read again by its ID alone: from
 * its `/proc/<pid>/stat` on Linux, and one run of `ps` for them all elsewhere.
 */
export async function stillRunning(members: readonly Member[]): Promise<Member[]> {
  if (members.length === 0) return [];
  const pids = members.map((member) => member.pid);
  const now = process.platform === 'linux' ? await fromProcIds(pids) : await fromPsIds(pids);
  const known = new Map(members.map((member) => [member.pid, member]));
  return now.filter((member) => sameProcess(member, known.get(member.pid)));
}

/** The family of the group `group`, and of each of `also`, with each member's resident memory. */
export const readFamily: ReadFamily = async (group, also = []) => {
  if (process.platform !== 'linux') return familyOf(await fromPs(), group, also);
  return withResident(familyOf(await fromProc(), group, also));
};

/**
 * `read`, with the server's services and what descends from them: each process named one of
 * `names` whose `HOME` is the server's home, as `home` gives it once the server has one, found by
 * `find` at each read and read as known before (`also`), so what a service starts is family too.
 */
export function withServices(
  read: ReadFamily,
  names: readonly string[],
  home: () => string | undefined,
  find: (names: readonly string[], home: string) => Promise<Member[]> = servicesOf,
): ReadFamily {
  return async (group, also = []) => {
    const where = home();
    const services = where === undefined ? [] : await find(names, where);
    return read(group, [...also, ...services]);
  };
}

/**
 * The processes named one of `names` whose `HOME` is `home`, exactly, with their resident memory:
 * on Linux from `/proc`, by the name the system gives each (the first 15 characters of its
 * program's file name) and its environment; elsewhere, on macOS, by `ps`, by its program's file
 * name, then its environment, as `ps -E` lists it, for those so named.
 */
export async function servicesOf(names: readonly string[], home: string): Promise<Member[]> {
  if (names.length === 0) return [];
  if (process.platform === 'linux') return servicesFromProc(names, home);
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', 'pid=,comm='], PS_OPTIONS);
  const named = namedInPs(stdout, names);
  if (named.length === 0) return [];
  const args = ['-E', '-ww', '-o', `${PS_COLUMNS},command=`, '-p', named.join(',')];
  return servicesInPs(await psListing(args), home);
}

/** The IDs in `ps -o pid=,comm=`'s lines whose program's file name is one of `names`. */
export function namedInPs(output: string, names: readonly string[]): number[] {
  return output.split('\n').flatMap((line) => {
    const [, pid = '', program = ''] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? [];
    return names.includes(basename(program)) ? [Number(pid)] : [];
  });
}

/**
 * The processes in `ps -E -o pid=,ppid=,pgid=,rss=,lstart=,command=`'s lines whose environment,
 * after the command, holds `HOME=<home>` as one of its variables: preceded by a space and followed
 * by another variable or the line's end, so a home that only begins with `home` isn't it.
 */
export function servicesInPs(output: string, home: string): Member[] {
  const line = new RegExp(
    String.raw`^(\s*\d+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s(.*)$`,
  );
  const variable = new RegExp(String.raw` HOME=${escaped(home)}(?= [A-Za-z_][A-Za-z0-9_]*=|$)`);
  return output.split('\n').flatMap((each) => {
    const [, columns = '', command = ''] = line.exec(each) ?? [];
    return variable.test(command) ? membersOfPs(columns) : [];
  });
}

/** `text`, matched as itself in a regular expression. */
function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** The processes named one of `names` whose `HOME` is `home`, from `/proc`. */
async function servicesFromProc(names: readonly string[], home: string): Promise<Member[]> {
  // The system keeps the first 15 characters of a program's file name as its name.
  const short = new Set(names.map((name) => name.slice(0, 15)));
  const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const found: string[] = [];
  for (let start = 0; start < pids.length; start += READS_AT_ONCE) {
    await Promise.all(
      pids.slice(start, start + READS_AT_ONCE).map(async (pid) => {
        try {
          const name = (await readFile(`/proc/${pid}/comm`, 'utf8')).replace(/\n$/, '');
          if (!short.has(name)) return;
          const environment = await readFile(`/proc/${pid}/environ`, 'utf8');
          if (environment.split('\0').includes(`HOME=${home}`)) found.push(pid);
        } catch {
          // It ended while it was read, or it isn't this user's.
        }
      }),
    );
  }
  return withResident(await fromProcIds(found));
}

/** `members`, each with its resident memory from its `/proc/<pid>/status`. */
async function withResident(members: readonly Member[]): Promise<Member[]> {
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
}

/**
 * The members of `table` in the group `group`, each of `also` that's still the same process, and
 * every process descended from one of them.
 */
export function familyOf(
  table: readonly Member[],
  group: number,
  also: readonly Member[] = [],
): Member[] {
  const known = new Map(also.map((member) => [member.pid, member]));
  const children = new Map<number, Member[]>();
  for (const member of table) {
    const siblings = children.get(member.parent);
    if (siblings === undefined) children.set(member.parent, [member]);
    else siblings.push(member);
  }
  const family = new Map<number, Member>();
  const waiting = table.filter(
    (member) => member.group === group || sameProcess(member, known.get(member.pid)),
  );
  for (let member = waiting.pop(); member !== undefined; member = waiting.pop()) {
    if (family.has(member.pid)) continue;
    family.set(member.pid, member);
    waiting.push(...(children.get(member.pid) ?? []));
  }
  return [...family.values()];
}

/** Whether `member` is `known`, read before: the same ID, started at the same time. */
export function sameProcess(member: Member, known: Member | undefined): boolean {
  return (
    known !== undefined &&
    member.pid === known.pid &&
    member.started !== undefined &&
    member.started === known.started
  );
}

/** Every process but a zombie, from its `/proc/<pid>/stat`. */
async function fromProc(): Promise<Member[]> {
  return fromProcIds((await readdir('/proc')).filter((name) => /^\d+$/.test(name)));
}

/** Each of `pids` that's running and not a zombie, from its `/proc/<pid>/stat`. */
async function fromProcIds(pids: readonly (number | string)[]): Promise<Member[]> {
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
  // After the name's closing parenthesis: state, parent and group, the 3rd to 5th fields, and its
  // start, in clock ticks since boot, the 22nd.
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  const [state, parent, group] = fields;
  const started = fields[19];
  const member = { pid, parent: Number(parent), group: Number(group), started };
  if (
    state === 'Z' ||
    started === undefined ||
    !/^\d+$/.test(started) ||
    ![member.pid, member.parent, member.group].every(Number.isSafeInteger)
  ) {
    return undefined;
  }
  return member;
}

/** The resident memory in a `/proc/<pid>/status` file, in bytes. */
export function residentOfStatus(status: string): number | undefined {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
  return match ? Number(match[1]) * 1024 : undefined;
}

/** What `ps` is asked for, and how it runs. */
const PS_COLUMNS = 'pid=,ppid=,pgid=,rss=,lstart=';
const PS_OPTIONS = {
  env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  timeout: 2000,
} as const;

/** Every process, with its resident memory, from one run of `ps`. */
async function fromPs(): Promise<Member[]> {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-A', '-o', PS_COLUMNS], PS_OPTIONS);
  return membersOfPs(stdout);
}

/** Each of `pids` that's running, from one run of `ps`. */
async function fromPsIds(pids: readonly number[]): Promise<Member[]> {
  return membersOfPs(await psListing(['-o', PS_COLUMNS, '-p', pids.join(',')]));
}

/** What `ps` lists with `args`, naming processes by ID, some of which may have gone. */
async function psListing(args: readonly string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('/bin/ps', args, PS_OPTIONS).catch(
    (error: unknown) => {
      // `ps` fails when any of them has gone, and still lists the rest.
      if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string') {
        return { stdout: error.stdout };
      }
      throw error;
    },
  );
  return stdout;
}

/**
 * The processes in `ps -o pid=,ppid=,pgid=,rss=,lstart=`'s lines, with their memory in bytes. The
 * start, last, is a date in words, such as `Sun Nov 15 12:52:33 2026`.
 */
export function membersOfPs(output: string): Member[] {
  const table: Member[] = [];
  for (const line of output.split('\n')) {
    const [pid, parent, group, resident, ...start] = line.trim().split(/\s+/);
    const numbers = [pid, parent, group, resident].map(Number);
    if (start.length === 0 || !numbers.every(Number.isSafeInteger)) continue;
    const [id = 0, parentId = 0, groupId = 0, pages = 0] = numbers;
    table.push({
      pid: id,
      parent: parentId,
      group: groupId,
      resident: pages * 1024,
      started: start.join(' '),
    });
  }
  return table;
}
