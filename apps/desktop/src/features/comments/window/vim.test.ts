// Lo's keys don't depend on Vim. With Vim keys off, as Lo starts, every command with a key still
// runs from that key wherever it's declared to; the only keys that go are Vim's own. A command
// added with a key that only Vim's modes could reach fails here.

import { plainKeys } from '@lo/ui/code';
import {
  Bindings,
  codeScopes,
  declaredBindings,
  isOwned,
  listOf,
  type Command,
  type Focus,
  type Mode,
  type System,
  type TargetKind,
} from '@lo/ui/commands';
import { describe, expect, test } from 'vitest';

import { featureCommands } from '../../../window/features.ts';

const commands = featureCommands();

/** Vim's own keys that a code view runs itself with Vim keys off, by their commands. */
const PLAIN: Readonly<Record<string, string>> = {
  'diff.down': plainKeys.down,
  'diff.up': plainKeys.up,
  'diff.search': plainKeys.search,
  'diff.nextMatch': plainKeys.nextMatch,
  'diff.previousMatch': plainKeys.previousMatch,
};

/** Vim's own keys with nothing to do without Vim: lines are selected with Shift, or by dragging,
 * and a box has no mode to leave. */
const VIM_ONLY = ['comments.leaveInsert', 'diff.select'];

const isCode = (scope: string): boolean => (codeScopes as readonly string[]).includes(scope);

/**
 * Where `command` should run with Vim keys off, in `scope`: a code view with no Vim is in normal
 * mode to Lo's keys, or in visual mode while lines are selected, and a comment box is typed in.
 * The key acts on what the command is for, if it's for one (`when.on`), and on nothing else.
 */
function places(command: Command, scope: string): Focus[] {
  const on = (kind: TargetKind) => kind === command.when?.on;
  if (!isCode(scope)) return [{ scope, text: false, on }];
  const plain: Mode[] = scope === 'box' ? ['insert'] : ['normal', 'visual'];
  const asked = listOf(command.when?.mode);
  return plain
    .filter((mode) => asked.length === 0 || asked.includes(mode))
    .map((mode) => ({ scope, text: false, view: { mode, pending: false, plain: true }, on }));
}

describe.each(['mac', 'linux'] as const)('with Vim keys off, on %s', (system: System) => {
  const declared = declaredBindings(commands, system);
  const bindings = new Bindings(system, declared);

  test('every key of Lo’s runs its command wherever the command is declared', () => {
    const lost: string[] = [];
    let checked = 0;
    for (const { command, strokes } of declared) {
      if (isOwned(command)) continue;
      const named = listOf(command.when?.scope);
      // One for anywhere is tried where there's no code, and in each view of code it's not kept
      // from. (Not in a box, which is typed in, whatever keys are on.)
      const scopes = named.length === 0 ? ['tab', 'diff', 'file', 'peek'] : named;
      for (const scope of scopes) {
        if (command.when?.except?.includes(scope)) continue;
        const runs = places(command, scope).some((focus) => {
          const found = bindings.find(strokes, focus).command;
          // A view's own command on the same key comes first, as it does with Vim keys on.
          return found === command || (named.length === 0 && found?.when?.scope !== undefined);
        });
        if (!runs) lost.push(`${command.id} in ${scope}`);
        checked += isCode(scope) ? 1 : 0;
      }
    }
    expect(lost).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });

  test('the keys documented as Vim’s own are the code view’s plain keys, but Vim’s alone', () => {
    const own = commands.filter((command) => command.vim === 'own');
    expect(own.map((command) => command.id).toSorted()).toEqual(
      [...Object.keys(PLAIN), ...VIM_ONLY].toSorted(),
    );
    const keys = Object.fromEntries(
      own.filter((command) => command.id in PLAIN).map((command) => [command.id, command.keys[0]]),
    );
    expect(keys).toEqual(PLAIN);
  });
});
