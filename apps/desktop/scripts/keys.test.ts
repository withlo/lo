import { defineCommands } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from '../src/features/keys/keys.ts';
import { code, keysDoc, readFeatures } from './keys.ts';

const diff = defineCommands('diff', {
  markViewed: {
    label: 'Mark viewed',
    group: 'Act',
    keys: ['e'],
    overVim: true,
    when: { scope: ['diff', 'tree'], mode: 'normal' },
  },
  nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], vim: 'motion' },
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
  open: { label: 'Open a PR', group: 'Find', keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }] },
  files: { label: 'Files', group: 'Find', keys: ['cmd+p'], overVim: true },
  quit: { label: 'Quit', group: 'Tabs and window', keys: ['cmd+q'], when: { system: 'linux' } },
});
const tree = defineCommands(
  'tree',
  {
    order: { label: 'Tree or review order', group: 'Files', keys: ['t'], when: { scope: 'tree' } },
  },
  { scopes: ['tree'] },
);
const doc = keysDoc([diff, keys, tree]);

/** The lines of `doc`'s section under `heading`, up to the next heading of its level or above. */
function section(heading: string): string[] {
  const lines = doc.split('\n');
  const start = lines.indexOf(heading);
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const end = lines.findIndex(
    (line, index) => index > start && (/^#+/.exec(line)?.[0].length ?? 99) <= level,
  );
  return lines.slice(start, end === -1 ? undefined : end);
}

describe('docs/keys.md', () => {
  it('lists key help’s groups in their order, in macOS form', () => {
    const headings = doc.split('\n').filter((line) => line.startsWith('## '));
    expect(headings.slice(0, 8)).toEqual([
      '## Move',
      '## Jump',
      '## Act',
      '## Code',
      '## Find',
      '## Files',
      '## Palettes',
      '## Tabs and window',
    ]);
    expect(section('## Find')).toContain(
      '| Open a PR | `⌘L`, `⌘O` (macOS only) | Anywhere | `diff.open` |',
    );
    expect(section('## Code')).toContain('| Back | `⌃o` | Anywhere but `box` | `keys.back` |');
    // A command on Linux only is listed with the keys for one system.
    expect(section('## Tabs and window').join('\n')).not.toContain('diff.quit');
  });

  it('says where each key applies', () => {
    expect(section('## Act')).toContain(
      '| Mark viewed | `e` | In `diff` and `tree`; in code views, only in normal mode | `diff.markViewed` |',
    );
    expect(section('## Jump')).toContain(
      "| Next file | `] f` | Anywhere; in code views, Vim's motion | `diff.nextFile` |",
    );
    expect(section('## Move')).toContain(
      "| Line down | `j` | Vim's own key, in code views | `diff.down` |",
    );
    expect(section('## Files')).toContain(
      '| Tree or review order | `t` | In `tree` | `tree.order` |',
    );
    expect(section('## Where keys apply')).toContain('| `tree` | Named by `tree`. |');
  });

  it('lists keys for one system in that system’s form', () => {
    const lines = section('## Keys for one system');
    expect(lines).toContain('| Open a PR | `⌘O` | macOS | Anywhere | `diff.open` |');
    expect(lines).toContain('| Quit | `Ctrl+Q` | Linux | Anywhere | `diff.quit` |');
    expect(lines.join('\n')).toContain(
      'Lo never takes `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+A`, `Ctrl+Z` or `Ctrl+W`',
    );
  });

  it('lists the keys over Vim’s, where, and on which system', () => {
    const lines = section("## Keys over Vim's");
    expect(lines).toContain('| `e` | Mark viewed | `e` | `diff` (normal) | `diff.markViewed` |');
    expect(lines).toContain(
      '| `Ctrl+P` (Linux) | Files | `Ctrl+P` | `diff`, `file`, `peek` and `box` (normal and visual) | `diff.files` |',
    );
    expect(lines).toContain('| `⌃o` | Back | `⌃o` | `diff`, `file` and `peek` | `keys.back` |');
    expect(lines.join('\n')).toContain("Vim runs Lo's motions (next file) under Lo's keys");
  });

  it('describes the keymap file, with an example that applies', () => {
    // The example's comments start with #, so the section is read as a whole.
    expect(doc).toContain('```\n# Open the command palette with ⌘K as well');
    expect(doc).toContain('\nbind cmd+k keys.palette\n');
    expect(section('### Writing keys').join('\n')).toContain('`f1` to `f20`');
    // How it is opened, and what Lo reads of it.
    expect(doc).toContain('the command palette or `g ,`: Lo opens it as text');
    expect(doc).toContain(
      "Opening never runs anything, so Lo doesn't open a file that is executable",
    );
    expect(doc).toContain('a file of up to 1 MiB and lines of up to 1,000 characters');
    expect(() => keysDoc([diff, tree])).toThrow(
      "The example keymap no longer applies: line 2: There's no command called keys.palette.",
    );
  });

  it('quotes any key as code, in a table', () => {
    expect(code('⌘⇧P')).toBe('`⌘⇧P`');
    expect(code('`')).toBe('`` ` ``');
    expect(code('a``b')).toBe('```a``b```');
    expect(code('|')).toBe('`\\|`');
  });
});

it('reads every feature’s keys.ts in Node', async () => {
  const features = await readFeatures(new URL('../src/features/', import.meta.url));
  expect(features.map((each) => each.feature)).toContain('keys');
  expect(features.find((each) => each.feature === 'keys')).toEqual(keys);
});
