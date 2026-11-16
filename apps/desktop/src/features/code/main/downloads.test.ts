// A server's downloads added up into one: those its adapter named count from the start, one it
// didn't counts once it starts, and one installed already counts for nothing.

import { expect, it } from 'vitest';

import { DownloadSum } from './downloads.ts';

it('counts what an adapter named from the first byte, as one download', () => {
  const heard: [number, number][] = [];
  const sum = new DownloadSum((done, total) => heard.push([done, total]));
  // The JDK and the server, neither installed yet.
  sum.expect('toolchain:temurin', 136);
  sum.expect('server:jdtls', 50);
  const jdk = sum.part('toolchain:temurin');
  jdk.progress(0, 136);
  jdk.progress(40, 136);
  jdk.done();
  const server = sum.part('server:jdtls');
  server.progress(20, 50);
  expect(heard).toEqual([
    [0, 186],
    [40, 186],
    [136, 186],
    [156, 186],
  ]);
});

it('counts one it didn’t name once it starts, and one installed already not at all', () => {
  const heard: [number, number][] = [];
  const sum = new DownloadSum((done, total) => heard.push([done, total]));
  // Installed already: nothing was expected of it, and it says nothing.
  sum.part('toolchain:go').done();
  sum.part('server:gopls').progress(5, 10);
  expect(heard).toEqual([[5, 10]]);
});
