import { defineCommands } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from '../src/features/keys/keys.ts';
import { code, keysDoc, readFeatures } from './keys.ts';

const diff = defineCommands('diff', {
  markViewed: {
    label: 'Mark viewed',
    group: 'Review',
    keys: ['e'],
    overVim: true,
    count: 'files',
    when: { scope: ['diff', 'tree'], mode: 'normal' },
  },
  nextFile: { label: 'Next file', group: 'Go', keys: ['] f'], vim: 'motion' },
  down: { label: 'Line down', group: 'Go', keys: ['j'], vim: 'own' },
  open: { label: 'Open a PR', group: 'Go', keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }] },
  files: { label: 'Files', group: 'Go', keys: ['cmd+p'], overVim: true },
  quit: { label: 'Quit', group: 'Tabs', keys: ['cmd+q'], when: { system: 'linux' } },
  install: {
    label: 'Install',
    group: 'Tabs',
    keys: [],
    bar: { menu: 'App', section: 'app', order: 1 },
  },
  undo: { label: 'Undo', group: 'Tabs', keys: [], control: 'Undo on its toast' },
  licenses: {
    label: 'Licenses',
    group: 'Tabs',
    keys: [],
    bar: { menu: 'App', section: 'app', order: 2 },
    menu: { on: 'none', order: 2 },
  },
  about: {
    label: 'About',
    group: 'Tabs',
    keys: [],
    when: { system: 'linux' },
    menu: { on: 'none', order: 1 },
  },
});
const tree = defineCommands(
  'tree',
  {
    order: { label: 'Tree or review order', group: 'Go', keys: ['t'], when: { scope: 'tree' } },
  },
  { scopes: ['tree'] },
);
const comments = defineCommands('comments', {
  add: {
    label: 'Add to review',
    group: 'Comments',
    keys: ['cmd+enter'],
    editor: true,
    when: { scope: 'box' },
  },
  leave: {
    label: 'Leave insert mode',
    group: 'Comments',
    keys: ['esc'],
    vim: 'own',
    when: { scope: 'box', mode: 'insert' },
  },
  close: {
    label: 'Close the box and keep the draft',
    group: 'Comments',
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
  it('lists the groups in their order, in macOS form', () => {
    const headings = doc.split('\n').filter((line) => line.startsWith('## '));
    expect(headings.slice(0, headings.indexOf('## Where keys apply'))).toEqual([
      '## Go',
      '## Review',
      '## Comments',
      '## View',
      '## Tabs',
      '## App',
    ]);
    expect(doc).toContain(
      'The commands are in 8 groups, the same in Keyboard shortcuts (`?`), the command palette and the app menu: Go, Review, Comments, Code, View, Merge, Tabs and App.',
    );
    expect(section('## Go')).toContain(
      '| Open a PR | `⌘L`, `⌘O` (macOS only) | Anywhere | `diff.open` |',
    );
    expect(section('## Go')).toContain('| Back | `⌃o` | Anywhere but `box` | `keys.back` |');
    // A command on Linux only is listed with the keys for one system.
    expect(section('## Tabs').join('\n')).not.toContain('diff.quit');
  });

  it('says where a command with no key is found instead', () => {
    expect(section('## Tabs')).toContain(
      '| Install | None: the app menu or the command palette | Anywhere | `diff.install` |',
    );
    expect(section('## Tabs')).toContain(
      '| Undo | None: its control or the command palette | Anywhere | `diff.undo` |',
    );
  });

  it('says where a command with no key in both the app menu and a right-click menu is found', () => {
    expect(section('## Tabs')).toContain(
      '| Licenses | None: the app menu, its right-click menu or the command palette | Anywhere | `diff.licenses` |',
    );
  });

  it('says where each key applies', () => {
    expect(section('## Review')).toContain(
      '| Mark viewed | `e` | In `diff` and `tree`; in code views, only in normal mode | `diff.markViewed` |',
    );
    expect(section('## Go')).toContain(
      "| Next file | `] f` | Anywhere; in code views with Vim keys on, Vim's motion | `diff.nextFile` |",
    );
    expect(section('## Go')).toContain(
      "| Line down | `j` | Vim's own key, in code views | `diff.down` |",
    );
    expect(section('## Go')).toContain('| Tree or review order | `t` | In `tree` | `tree.order` |');
    expect(section('## Where keys apply')).toContain('| `tree` | Named by `tree`. |');
  });

  it('lists the keys an editor handles itself, saying the keymap file can’t change them', () => {
    const lines = section('## Comments');
    expect(lines).toContain(
      "| Add to review | `⌘⏎` | In `box`; the editor's own key, which the keymap file can't change | `comments.add` |",
    );
    expect(lines).toContain(
      "| Close the box and keep the draft | `Esc` | In `box`; in code views, only in normal mode; the editor's own key, which the keymap file can't change | `comments.close` |",
    );
    expect(lines).toContain(
      "| Leave insert mode | `Esc` | Vim's own key, in code views | `comments.leave` |",
    );
    const note = lines.join('\n');
    expect(note).toContain(
      'neither the keymap file nor a `vim` line in it can change them. A `bind` that names one, or would take its keys in a comment box, is reported',
    );
    // What `⌘⏎` and `⌥⏎` do in each kind of box, and `Esc` in the preview.
    expect(note).toContain("in the review summary's box it submits the review");
    expect(note).toContain(
      'it posts the comment; in a box that edits one of your comments it saves',
    );
    expect(note).toContain("In the box's preview, or on its frame, `Esc` closes it at once");
    expect(section('## Where keys apply')).not.toContain('comments.add');
    expect(doc).toContain("names one of Vim's own keys or one of the comment box's");
    expect(doc).toContain("A `vim` line can't take them either");
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
    // One with no key on purpose says where it's found instead, and is no more on macOS's list.
    expect(lines).toContain(
      '| About | None: its right-click menu or the command palette | Linux | Anywhere | `diff.about` |',
    );
    expect(section('## Tabs').join('\n')).not.toContain('diff.about');
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
    expect(lines.join('\n')).toContain(
      "Vim runs Lo's motions in code views (next file) under Lo's keys",
    );
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
    expect(doc).toContain('a file of up to 1 MB and lines of up to 1,000 characters');
    expect(() => keysDoc([diff, tree])).toThrow(
      'The example keymap no longer applies: line 2: No command `keys.palette`',
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
