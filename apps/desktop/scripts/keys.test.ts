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
    count: 'files',
    when: { scope: ['diff', 'tree'], mode: 'normal' },
  },
  nextFile: { label: 'Next file', group: 'Jump', keys: ['] f'], vim: 'motion' },
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own' },
  open: { label: 'Open a PR', group: 'Find', keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }] },
  files: { label: 'Files', group: 'Find', keys: ['cmd+p'], overVim: true },
  quit: { label: 'Quit', group: 'Tabs and window', keys: ['cmd+q'], when: { system: 'linux' } },
  install: { label: 'Install', group: 'Tabs and window', keys: [], bar: { menu: 'App', order: 1 } },
});
const tree = defineCommands(
  'tree',
  {
    order: { label: 'Tree or review order', group: 'Files', keys: ['t'], when: { scope: 'tree' } },
  },
  { scopes: ['tree'] },
);
const comments = defineCommands('comments', {
  add: {
    label: 'Add to review',
    group: 'Comment box',
    keys: ['cmd+enter'],
    editor: true,
    when: { scope: 'box' },
  },
  leave: {
    label: 'Leave insert mode',
    group: 'Comment box',
    keys: ['esc'],
    vim: 'own',
    when: { scope: 'box', mode: 'insert' },
  },
  close: {
    label: 'Close the box and keep the draft',
    group: 'Comment box',
    keys: ['esc'],
    editor: true,
    when: { scope: 'box', mode: 'normal' },
  },
});
const doc = keysDoc([diff, keys, tree, comments]);

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
    expect(headings.slice(0, 9)).toEqual([
      '## Move',
      '## Jump',
      '## Act',
      '## Code',
      '## Find',
      '## Files',
      '## Comment box',
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

  it('says where a command with no key is found instead', () => {
    expect(section('## Tabs and window')).toContain(
      '| Install | None: in the app menu and the palette | Anywhere | `diff.install` |',
    );
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

  it('lists the keys an editor handles itself, saying the keymap file can’t change them', () => {
    const lines = section('## Comment box');
    expect(lines).toContain(
      "| Add to review | `⌘⏎` | In `box`; the editor's own key, which the keymap file can't change | `comments.add` |",
    );
    expect(lines).toContain(
      "| Close the box and keep the draft | `Esc` | In `box`; in code views, only in normal mode; the editor's own key, which the keymap file can't change | `comments.close` |",
    );
    expect(lines).toContain(
      "| Leave insert mode | `Esc` | Vim's own key, in code views | `comments.leave` |",
    );
    expect(lines.join('\n')).toContain(
      "the keymap file can't change them. A `bind` that names one, or would take its keys in a comment box, is reported",
    );
    expect(section('## Where keys apply')).not.toContain('comments.add');
    expect(doc).toContain("names one of Vim's own keys or one of the comment box's");
    // Neither is a key over Vim's, which a keymap's `bind` could replace.
    expect(section("## Keys over Vim's").join('\n')).not.toContain('comments.');
  });

  it('lists the commands that take a count, what one counts, and where digits are one', () => {
    const lines = section('## Counts');
    expect(lines).toContain(
      '| Mark viewed | `e` | files | In `diff` and `tree`; in code views, only in normal mode | `diff.markViewed` |',
    );
    expect(lines.join('\n')).toContain('Elsewhere digits are a count only in `tree`');
    expect(section('## Where keys apply').join('\n')).toContain(
      'In a code view it waits however long it takes',
    );
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
