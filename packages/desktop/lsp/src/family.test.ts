import { expect, test } from 'vitest';

import {
  familyOf,
  memberOfStat,
  membersOfPs,
  namedInPs,
  residentOfStatus,
  servicesInPs,
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

test('a service is a process of its name whose HOME is the server’s home, exactly', () => {
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
  const line = (pid: number, command: string) => ` ${pid}  1 ${pid}  2048 ${START} ${command}`;
  const listing = [
    line(501, `${service} LANG=C.UTF-8 HOME=${home} TMPDIR=${home}/tmp`),
    // Its home last of all.
    line(503, `${service} LANG=C.UTF-8 HOME=${home}`),
    // Another server's, whose home only begins with this one's, or is inside it.
    line(505, `${service} HOME=${home}-2 PATH=/usr/bin`),
    line(506, `${service} HOME=${home}/inner PATH=/usr/bin`),
    // Its home only in another variable's value, or in its arguments with nothing after it.
    line(507, `${service} OTHER=HOME=${home} PATH=/usr/bin`),
    line(508, `${service} --as-HOME=${home}x PATH=/usr/bin`),
    '',
  ].join('\n');
  const found = servicesInPs(listing, home);
  expect(pids(found)).toEqual([501, 503]);
  expect(found[0]).toEqual({
    pid: 501,
    parent: 1,
    group: 501,
    resident: 2048 * 1024,
    started: START,
  });
  // A home with what a pattern would take as its own is matched as itself.
  expect(pids(servicesInPs(line(509, `${service} HOME=/a+b/(c)`), '/a+b/(c)'))).toEqual([509]);
  expect(pids(servicesInPs(line(510, `${service} HOME=/aab/(c)`), '/a+b/(c)'))).toEqual([]);
});

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
