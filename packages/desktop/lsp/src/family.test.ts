import { spawn } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';

import { tempFolder } from '../test/support.ts';
import {
  familyOf,
  memberOfStat,
  membersOfPs,
  namedInPs,
  residentOfStatus,
  servicesInPs,
  servicesOf,
  withServices,
} from './family.ts';

const START = 'Sun Nov 15 12:52:33 2026';

/** `ps` lines for `rows` of pid, parent, group and resident kilobytes, each started at `START`. */
function ps(rows: readonly (readonly [number, number, number, number | string])[]): string {
  return [...rows.map((row) => ` ${row.join('  ')} ${START}`), ''].join('\n');
}

function pids(members: readonly { pid: number }[]): number[] {
  return members.map((member) => member.pid).toSorted((a, b) => a - b);
}

test('a family is its group and every process descended from it, wherever its group', () => {
  const table = membersOfPs(
    ps([
      [1, 0, 1, 9000],
      [200, 1, 200, 1000],
      [201, 200, 200, 24],
      [300, 201, 300, 500],
      [301, 300, 300, 8],
      [400, 1, 400, 7777],
      [401, 400, 400, 'abc'],
    ]),
  );
  // The server, 200, started 201 in its group, which started 300 in a session of its own.
  expect(pids(familyOf(table, 200))).toEqual([200, 201, 300, 301]);
  expect(familyOf(table, 200).reduce((sum, member) => sum + (member.resident ?? 0), 0)).toBe(
    1532 * 1024,
  );
  expect(familyOf(table, 200)[0]?.started).toBe(START);
  expect(familyOf(table, 999)).toEqual([]);
  expect(residentOfStatus('Name:\tnode\nVmRSS:\t   2048 kB\nThreads:\t7\n')).toBe(2048 * 1024);
});

test('a process read before is in the family while it’s the same process, with what it started', () => {
  // 300 left the group, and its parent has gone, so nothing ties it to the server but having been
  // read before.
  const before = { pid: 300, parent: 201, group: 300, started: START };
  const table = membersOfPs(
    ps([
      [200, 1, 200, 1000],
      [300, 1, 300, 500],
      [301, 300, 301, 8],
    ]),
  );
  expect(pids(familyOf(table, 200, [before]))).toEqual([200, 300, 301]);
  // Its ID, started again later, is another process: not the server's.
  expect(pids(familyOf(table, 200, [{ ...before, started: 'Sun Nov 15 12:52:30 2026' }]))).toEqual([
    200,
  ]);
  expect(pids(familyOf(table, 200, [{ ...before, started: undefined }]))).toEqual([200]);
});

/** A stat line's fields after its name, in `state`, started at tick 987654. */
function fields(state: string): string {
  return `${state} 1 4200 4200 0 -1 4194560 120 0 0 0 5 6 0 0 20 0 1 0 987654 1000 200`;
}

test('a process’s stat gives its parent, group and start, whatever its name', () => {
  expect(memberOfStat(`4242 (a) b (c) ${fields('S')}`)).toEqual({
    pid: 4242,
    parent: 1,
    group: 4200,
    started: '987654',
  });
  expect(memberOfStat(`4243 (gone) ${fields('Z')}`)).toBeUndefined();
  expect(memberOfStat('4244 (short) S 1 4200 4200')).toBeUndefined();
});

test('a service is a process of its name whose HOME is the server’s home, as a whole entry', () => {
  const home = '/lo/code/homes/a/x/swift';
  const service = '/Xcode/XPCServices/SourceKitService.xpc/Contents/MacOS/SourceKitService';
  // Programs by their file names: a path's last part, never a name that only ends with it.
  expect(
    namedInPs(
      [
        ` 501 ${service}`,
        ' 502 /usr/bin/NotSourceKitService',
        ' 503 SourceKitService',
        ' 504 /bin/zsh',
        '',
      ].join('\n'),
      ['SourceKitService'],
    ),
  ).toEqual([501, 503]);
  const line = (pid: number, command: string, start = START) =>
    ` ${pid}  1 ${pid}  2048 ${start} ${command}`;
  /**
   * `ps`'s two listings of processes, each a pid, its program and arguments, and its environment:
   * without `-E`, then with it. An environment `ps` can't read is `undefined`.
   */
  const listings = (rows: readonly (readonly [number, string, string | undefined])[]) =>
    [
      [...rows.map(([pid, command]) => line(pid, command)), ''].join('\n'),
      [
        ...rows.map(([pid, command, environment]) =>
          line(pid, environment === undefined ? command : `${command} ${environment}`),
        ),
        '',
      ].join('\n'),
    ] as const;
  const [commands, listed] = listings([
    [501, service, `LANG=C.UTF-8 HOME=${home} TMPDIR=${home}/tmp`],
    // Its home first of all, and last.
    [502, service, `HOME=${home} LANG=C.UTF-8`],
    [503, service, `LANG=C.UTF-8 HOME=${home}`],
    // Another server's, whose home only begins with this one's, or is inside it.
    [505, service, `HOME=${home}-2 PATH=/usr/bin`],
    [506, service, `HOME=${home}/inner PATH=/usr/bin`],
    // Its home only in another variable's value, or in its arguments, alone or before more.
    [507, service, `OTHER=HOME=${home} PATH=/usr/bin`],
    [508, `${service} HOME=${home}`, 'PATH=/usr/bin'],
    [509, `${service} --as HOME=${home} --then`, 'PATH=/usr/bin'],
    // Its home in its arguments, and an environment `ps` can't read.
    [510, `${service} HOME=${home}`, undefined],
  ]);
  const found = servicesInPs(commands, listed, home);
  expect(pids(found)).toEqual([501, 502, 503]);
  expect(found[0]).toEqual({
    pid: 501,
    parent: 1,
    group: 501,
    resident: 2048 * 1024,
    started: START,
  });
  // A process whose arguments aren't those listed without `-E`, as when it changed them between
  // the listings, or that isn't the same process there, by its start, isn't.
  const changed = line(511, `${service} --now HOME=${home}`);
  expect(servicesInPs(line(511, `${service} --was`), changed, home)).toEqual([]);
  const later = line(512, `${service} HOME=${home}`);
  expect(servicesInPs(line(512, service, 'Mon Nov 16 09:00:00 2026'), later, home)).toEqual([]);
  // A home with a space, as a build run from source has (`Lo Dev`), is matched whole.
  const dev = '/var/folders/x/C/Lo Dev/code/homes/a/x/swift';
  const [spaced, spacedListed] = listings([[513, service, `HOME=${dev} PATH=/usr/bin`]]);
  expect(pids(servicesInPs(spaced, spacedListed, dev))).toEqual([513]);
  // A home with what a pattern would take as its own is matched as itself.
  const [pattern, patternListed] = listings([
    [514, service, 'HOME=/a+b/(c)'],
    [515, service, 'HOME=/aab/(c)'],
  ]);
  expect(pids(servicesInPs(pattern, patternListed, '/a+b/(c)'))).toEqual([514]);
  // What `ps` can't tell apart from a whole entry, since it joins them with spaces: a value that
  // holds the home's entry, then the end or what looks like another variable.
  const [joined, joinedListed] = listings([[516, service, `OTHER=x HOME=${home} PATH=/usr/bin`]]);
  expect(pids(servicesInPs(joined, joinedListed, home))).toEqual([516]);
});

test.runIf(process.platform === 'darwin')(
  'on macOS, `ps` finds a service by the HOME in its environment, never by one in its arguments',
  async () => {
    const folder = tempFolder();
    const home = join(folder, 'home');
    // Node by a service's name, as the system would start one: no child of this process's group.
    const program = join(folder, 'LoFamilyService');
    symlinkSync(process.execPath, program);
    const start = (args: readonly string[], as: string) => {
      const child = spawn(program, ['-e', 'setInterval(() => undefined, 1000);', ...args], {
        env: { HOME: as, PATH: '/usr/bin:/bin' },
        detached: true,
        stdio: 'ignore',
      });
      onTestFinished(() => {
        child.kill('SIGKILL');
      });
      return child.pid ?? 0;
    };
    const ours = start([], home);
    // The home only as an argument, just before its own environment.
    const argued = start([`HOME=${home}`], folder);
    const names = ['LoFamilyService'];
    await vi.waitFor(
      async () => {
        expect(pids(await servicesOf(names, home))).toEqual([ours]);
        // Found by its own HOME, so it was there to be seen.
        expect(pids(await servicesOf(names, folder))).toEqual([argued]);
      },
      { timeout: 10_000, interval: 100 },
    );
  },
);

test('a server’s services are read with its family, and what they start, once it has a home', async () => {
  // The server, 200, and its child; the system's service for it, 400, which started 401 in a group
  // of its own; and 500, another process.
  const table = membersOfPs(
    ps([
      [200, 1, 200, 10],
      [201, 200, 200, 10],
      [400, 1, 400, 20],
      [401, 400, 401, 30],
      [500, 1, 500, 40],
    ]),
  );
  const asked: string[] = [];
  let home: string | undefined;
  const read = withServices(
    (group, also) => Promise.resolve(familyOf(table, group, also)),
    ['SourceKitService'],
    () => home,
    (names, where) => {
      asked.push(`${names.join(',')} ${where}`);
      return Promise.resolve(table.filter((member) => member.pid === 400));
    },
  );
  expect(pids(await read(200))).toEqual([200, 201]);
  home = '/lo/home';
  expect(pids(await read(200))).toEqual([200, 201, 400, 401]);
  expect(asked).toEqual(['SourceKitService /lo/home']);
});
