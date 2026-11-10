// Downloads the files the committed manifests describe into the cache, from the public repos with
// git. Needs no token. Safe to rerun: it downloads only what's missing.
//
//   pnpm nx run perf:fetch                    every PR
//   pnpm nx run perf:fetch -- typescript-54820  one PR, by its manifest's name
//
// The cache is `~/.cache/lo/perf`, or `$XDG_CACHE_HOME/lo/perf`, or `$LO_PERF_CACHE`.

import { cacheFolder, fetchPullRequest } from '../src/data/cache.ts';
import { manifestNames, readManifest } from '../src/data/manifest.ts';

const names = process.argv.slice(2);
const cache = cacheFolder();
let failed = false;
for (const name of names.length > 0 ? names : manifestNames()) {
  const started = performance.now();
  try {
    const manifest = readManifest(name);
    const result = await fetchPullRequest(manifest, { cache });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `${name}: ${manifest.files.length} files, ${result.blobs} blobs, ` +
        `${(result.bytes / 1e6).toFixed(1)} MB; downloaded ${result.downloaded} in ${seconds} s`,
    );
  } catch (error) {
    failed = true;
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`Cache: ${cache}`);
if (failed) process.exit(1);
