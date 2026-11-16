// A server's downloads added up into one: those its adapter named count from the start, one it
// didn't counts once it starts, one installed already counts for nothing, and one that has come
// says so while it's unpacked.

import { expect, it } from 'vitest';

import { DownloadSum } from './downloads.ts';

it('counts what an adapter named from the first byte, as one download', () => {
  const heard: [number, number][] = [];
  const sum = new DownloadSum((done, total) => heard.push([done, total]));
  // The JDK and the server, neither installed yet.
  sum.expect('toolchain:temurin', 136);
  sum.expect('server:jdtls', 50);
  const jdk = sum.part('toolchain:temurin');
  jdk.progress(0, 136, false);
  jdk.progress(40, 136, false);
  jdk.done();
  const server = sum.part('server:jdtls');
  server.progress(20, 50, false);
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
  sum.part('server:gopls').progress(5, 10, false);
  expect(heard).toEqual([[5, 10]]);
});

it('says one is unpacking once all of it has come, until it’s installed', () => {
  const heard: [number, number, boolean][] = [];
  const sum = new DownloadSum((done, total, unpacking) => heard.push([done, total, unpacking]));
  sum.expect('toolchain:dotnet', 164);
  sum.expect('server:roslyn', 40);
  const sdk = sum.part('toolchain:dotnet');
  sdk.progress(164, 164, false);
  sdk.progress(164, 164, true);
  sdk.done();
  sum.part('server:roslyn').progress(10, 40, false);
  expect(heard).toEqual([
    [164, 204, false],
    [164, 204, true],
    [164, 204, false],
    [174, 204, false],
  ]);
});
