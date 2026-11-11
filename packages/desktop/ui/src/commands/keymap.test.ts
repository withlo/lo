import { describe, expect, test } from 'vitest';

import { testCommands } from '../../test/commands.ts';
import { applyKeymap, parseKeymap } from './keymap.ts';
import { declaredBindings } from './match.ts';
import { writeKeys, writeStrokes } from './notation.ts';

const commands = new Set(['diff.markViewed', 'diff.nextFile', 'stacks.make']);
const read = (text: string) => parseKeymap(text, (id) => commands.has(id));

describe('the keymap file', () => {
  test('reads bind, unbind and vim lines, skipping comments and blank lines', () => {
    const keymap = read(
      [
        '# Mark files viewed with x.',
        'bind x diff.markViewed',
        '',
        '  unbind   e  ',
        'unbind g S stacks.make',
        'bind ] n diff.nextFile',
        'vim normal Y y$',
        'vim insert jk <Esc>',
        'vim normal <Space>w :w  <CR>',
      ].join('\n'),
    );
    expect(keymap.errors).toEqual([]);
    expect(
      keymap.lines.map((line) =>
        line.kind === 'vim'
          ? [line.line, line.kind, line.mode, line.keys, line.to]
          : [line.line, line.kind, writeKeys(line.keys), line.command],
      ),
    ).toEqual([
      [2, 'bind', 'x', 'diff.markViewed'],
      [4, 'unbind', 'e', undefined],
      [5, 'unbind', 'g S', 'stacks.make'],
      [6, 'bind', '] n', 'diff.nextFile'],
      [7, 'vim', 'normal', 'Y', 'y$'],
      [8, 'vim', 'insert', 'jk', '<Esc>'],
      // What the keys do is kept as written.
      [9, 'vim', 'normal', '<Space>w', ':w  <CR>'],
    ]);
  });

  test('numbers lines through any line ending and a byte order mark', () => {
    const keymap = read('﻿bind x diff.markViewed\r\n\r\nbind y oops\rbind z diff.markViewed');
    expect(keymap.lines.map((line) => line.line)).toEqual([1, 4]);
    expect(keymap.errors).toEqual([{ line: 3, message: "There's no command called oops." }]);
  });

  test('reports each line it can’t read with its number, and keeps the rest', () => {
    const keymap = read(
      [
        'bind x diff.markViewed',
        'map x diff.markViewed',
        'bind diff.markViewed',
        'bind x diff.unknown',
        'bind cmdd+x diff.markViewed',
        'bind cmd+ diff.markViewed',
        'bind shift+shift+x diff.markViewed',
        'bind return diff.markViewed',
        'unbind',
        'unbind e diff.unknown',
        'unbind cmd+',
        'vim normal Y',
        'vim command Y y$',
        'vim',
        'unbind e',
      ].join('\n'),
    );
    expect(keymap.errors).toEqual([
      { line: 2, message: 'A line starts with bind, unbind, vim or #, not map.' },
      { line: 3, message: 'bind takes keys, then a command: bind x diff.markViewed.' },
      { line: 4, message: "There's no command called diff.unknown." },
      { line: 5, message: '"cmdd" in "cmdd+x" isn\'t a modifier: use cmd, ctrl, alt or shift.' },
      { line: 6, message: '"cmd+" has no key after its last "+".' },
      { line: 7, message: '"shift+shift+x" holds shift twice.' },
      {
        line: 8,
        message: '"return" isn\'t a key: write one character, or a name such as enter.',
      },
      { line: 9, message: 'unbind takes keys, and a command if only its keys go: unbind e.' },
      { line: 10, message: "There's no command called diff.unknown." },
      { line: 11, message: '"cmd+" has no key after its last "+".' },
      { line: 12, message: 'vim takes a mode, keys and what they do: vim normal Y y$.' },
      { line: 13, message: "command isn't a Vim mode here: use normal, visual or insert." },
      { line: 14, message: 'vim takes a mode, keys and what they do: vim normal Y y$.' },
    ]);
    expect(keymap.lines.map((line) => line.line)).toEqual([1, 15]);
  });

  test('without a list of commands, takes any id written as one', () => {
    expect(parseKeymap('bind x some.command').errors).toEqual([]);
    expect(parseKeymap('bind x notACommand').errors).toEqual([
      { line: 1, message: "There's no command called notACommand." },
    ]);
  });

  test('a bind keeps another from running only where both apply, at the same level', () => {
    const all = testCommands();
    const byId = new Map(all.map((command) => [command.id, command]));
    const apply = (text: string) =>
      applyKeymap(
        declaredBindings(all, 'mac'),
        parseKeymap(text, (id) => byId.has(id)).lines,
        byId,
        'mac',
      );
    // The tree has no `g` sequence; a key for anywhere gives way to a scope's `g i` in the diff;
    // the same keys for another command take its place.
    const fine = apply(
      'bind g tree.openAll\nbind g keys.help\nbind z keys.palette\nbind y l diff.comment',
    );
    expect(fine.errors).toEqual([]);
    expect(writeStrokes(fine.bindings[0]!.strokes, 'mac')).toBe('y l');
    // A scope's lone `z` against the tree's `z R`.
    expect(apply('bind z tree.closeAll').errors).toEqual([
      { line: 1, message: 'z would keep z R (tree.openAll) from ever running.' },
    ]);
    // Bindings for ⌘ are written back as cmd.
    expect(apply('bind cmd+shift+p x keys.help').errors).toEqual([
      { line: 1, message: 'cmd+shift+p x would never run: cmd+shift+p (keys.palette) runs first.' },
    ]);
  });
});
