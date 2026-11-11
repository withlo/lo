import { parseOid, type TreeEntry } from '@lo/git';
import type { TreeItem } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { PATH_LIMIT } from '../contract.ts';
import { Files, fromGithub, fromLocal } from './listing.ts';

/** A name of `bytes` bytes, longer than any the tree shows. */
const longName = (bytes: number) => 'n'.repeat(bytes);

/** How long `work` takes, in milliseconds. */
function timed(work: () => void): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe('a commit’s files', () => {
  it('leaves out paths too long to key a map by, quickly, however many there are', () => {
    // 4,000 folders, each holding a file, under a folder with a 16,400-byte name: git keeps the
    // name once, so the repository is small, but a map keyed by these paths hashes them all alike.
    const folder = longName(16_400);
    const items: TreeItem[] = [{ path: folder, type: 'tree', mode: '040000', sha: 'a' }];
    for (let index = 0; index < 4_000; index++) {
      items.push({ path: `${folder}/d${index}`, type: 'tree', mode: '040000', sha: 'b' });
      items.push({ path: `${folder}/d${index}/f.txt`, type: 'blob', mode: '100644', sha: 'c' });
    }
    items.push({ path: 'README.md', type: 'blob', mode: '100644', sha: 'd' });
    let listed: ReturnType<typeof fromGithub> | undefined;
    let sent: unknown;
    let found: unknown;
    const took = timed(() => {
      listed = fromGithub(items);
      const files = new Files(listed.files, 0);
      sent = files.listing();
      found = files.folders([{ text: `${folder}/d1` }, { text: folder }]);
    });
    expect(took).toBeLessThan(2_000);
    expect(listed?.omitted).toBe(4_000);
    expect(sent).toEqual({
      kind: 'folders',
      root: [{ path: { text: 'README.md' }, kind: 'file' }],
    });
    expect(found).toEqual([]);
  });

  it('counts a path by its bytes, keeping one of exactly the limit', () => {
    const oid = parseOid('1'.repeat(40));
    const entry = (bytes: number): TreeEntry => ({
      path: Buffer.concat([Buffer.alloc(bytes - 2, 0xe9), Buffer.from('.c')]),
      oid,
      mode: 'regular',
    });
    const listed = fromLocal([entry(PATH_LIMIT), entry(PATH_LIMIT + 1)]);
    expect(listed.omitted).toBe(1);
    expect(listed.files.map((file) => file.path.hex?.length)).toEqual([PATH_LIMIT * 2]);
    // é is two bytes in UTF-8.
    expect(
      fromGithub([{ path: 'é'.repeat(513), type: 'blob', mode: '100644', sha: 'a' }]),
    ).toMatchObject({
      omitted: 1,
      files: [],
    });
  });
});
