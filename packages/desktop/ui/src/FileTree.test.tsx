import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { FileTree, FileTreePanel, type FileTreeRow } from './FileTree.tsx';

const rows: FileTreeRow[] = [
  { kind: 'group', key: 'g', label: 'Source and tests' },
  { kind: 'folder', key: 'src/api', names: ['src', 'api'], depth: 0, open: true, changes: 3 },
  { kind: 'folder', key: 'src/api/old', names: ['old'], depth: 1, open: false, changes: 2 },
  { kind: 'folder', key: 'docs', names: ['docs'], depth: 0, open: true, changes: 0, loading: true },
  {
    kind: 'file',
    key: 'src/api/a.ts',
    name: 'a.ts',
    depth: 1,
    entry: 'file',
    change: 'renamed',
    previous: 'b.ts',
    viewed: 'viewed',
  },
  {
    kind: 'file',
    key: 'gone.ts',
    name: 'gone.ts',
    depth: 0,
    entry: 'symlink',
    change: 'deleted',
    viewed: 'dismissed',
  },
  {
    kind: 'file',
    key: 'pnpm-lock.yaml',
    name: 'pnpm-lock.yaml',
    depth: 0,
    entry: 'file',
    change: 'modified',
    generated: true,
    viewed: 'unviewed',
    folder: 'web',
  },
  { kind: 'file', key: 'README.md', name: 'README.md', depth: 0, entry: 'submodule' },
];

function markup(): string {
  return renderToStaticMarkup(
    <FileTreePanel
      viewed={{ viewed: 1, total: 3 }}
      mode="tree"
      modeKeys={['t']}
      changedOnly
      changedOnlyKeys={['f']}
      note="Only the changed files show."
    >
      <FileTree rows={rows} focused="src/api/a.ts" current="src/api/a.ts" aria-label="Files" />
    </FileTreePanel>,
  );
}

describe('FileTree', () => {
  it('draws folders, chains, counts and the marks of each change', () => {
    const html = markup();
    expect(html).toContain('role="tree"');
    // A chain on one row, its names split by slashes.
    expect(html).toMatch(/src<\/span><span><span class="[^"]*">\/<\/span>api/);
    // A closed folder's count; an open one has none.
    expect(html).toContain('title="2 changed files"');
    expect(html).not.toContain('title="3 changed files"');
    expect(html).toContain('← b.ts');
    expect(html).toContain('title="Changed since you viewed it"');
    expect(html).toContain('>gen<');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('1 / 3');
    expect(html).toContain('Only the changed files show.');
  });

  it("only uses utilities that Lo's stylesheet has, so no spacing is silently dropped", async () => {
    const classes = [
      ...new Set(
        [...markup().matchAll(/class="([^"]*)"/g)].flatMap(([, value]) =>
          (value ?? '').split(/\s+/),
        ),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    expect(classes.length).toBeGreaterThan(30);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
