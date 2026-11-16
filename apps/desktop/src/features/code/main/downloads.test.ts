// A server's downloads added up into one: those its adapter named count from the start, one it
// didn't counts once it starts, one installed already counts for nothing, and one that has come
// says so while it's unpacked or built.

import { expect, it } from 'vitest';

import { DownloadSum } from './downloads.ts';

it('counts what an adapter named from the first byte, as one download', () => {
  const heard: [number, number][] = [];
  const sum = new DownloadSum((done, total) => heard.push([done, total]));
  // The JDK and the server, neither installed yet.
  sum.expect('toolchain:temurin', 136);
  sum.expect('server:jdtls', 50);
  const jdk = sum.part('toolchain:temurin');
  jdk.progress(0, 136, 'downloading');
  jdk.progress(40, 136, 'downloading');
  jdk.done();
  const server = sum.part('server:jdtls');
  server.progress(20, 50, 'downloading');
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
  sum.part('server:gopls').progress(5, 10, 'downloading');
  expect(heard).toEqual([[5, 10]]);
});

it('says one is unpacking, or building, once all of it has come, until it’s installed', () => {
  const heard: [number, number, string][] = [];
  const sum = new DownloadSum((done, total, stage) => heard.push([done, total, stage]));
  sum.expect('toolchain:go', 164);
  sum.expect('server:gopls', 40);
  const go = sum.part('toolchain:go');
  go.progress(164, 164, 'downloading');
  go.progress(164, 164, 'unpacking');
  go.done();
  const gopls = sum.part('server:gopls');
  gopls.progress(40, 40, 'unpacking');
  gopls.progress(40, 40, 'building');
  gopls.done();
  expect(heard).toEqual([
    [164, 204, 'downloading'],
    [164, 204, 'unpacking'],
    [164, 204, 'downloading'],
    [204, 204, 'unpacking'],
    [204, 204, 'building'],
    [204, 204, 'downloading'],
  ]);
});
