// Writes docs/keys.md: Lo's keys as every feature's keys.ts declares them, read in Node rather than
// from a running app. Prettier formats it after.
//
//   pnpm nx run desktop:codegen

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  codeScopes,
  commandsOf,
  engineScopes,
  groups,
  keyLabels,
  KEYMAP_LINE_LIMIT,
  keyless,
  keyNames,
  linuxEditingKeys,
  listed,
  listOf,
  modesOf,
  parseKeymap,
  parseKeys,
  SEQUENCE_TIMEOUT,
  systemNames,
  systemStrokes,
  systems,
  systemsOf,
  vimDefaults,
  vimMeetings,
  writeStrokes,
  type Command,
  type Declarations,
  type KeySpec,
  type Mode,
  type System,
  type VimKeys,
} from '@lo/ui/commands';

import { KEYMAP_SIZE_LIMIT } from '../src/features/keys/contract.ts';
import { checkDeclarations } from '../src/window/commands/declarations.ts';

/** `text` as inline code, which a table cell can hold: its `|` escaped, its backticks fenced. */
export function code(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded.replaceAll('|', '\\|')}${fence}`;
}

/** Keys as `system` shows them, one label per key of a sequence: `⌘⇧P`, `] f`, `Ctrl+O`. */
function form(keys: string, system: System): string {
  return keyLabels(systemStrokes(parseKeys(keys), system), system).join(' ');
}

/** A default key's keys, and the one system it's for, if it's for one. */
function specOf(spec: KeySpec): { keys: string; on: System | undefined } {
  return typeof spec === 'string' ? { keys: spec, on: undefined } : spec;
}

/** What each of the engine's and the code views' scopes is. */
const scopeMeanings: Readonly<Record<string, string>> = {
  window: 'Anywhere no other scope has focus.',
  menu: 'A menu. Only commands that name it run there, and `j` and `k` move as `↓` and `↑` do.',
  dialog: "A dialog, which keeps the browser's `Tab`.",
  palette: 'A palette, such as the command palette.',
  diff: 'The diff, a code view.',
  file: 'A whole file, a code view.',
  peek: 'A peek at code elsewhere, such as a definition, a code view.',
  box: 'A comment box, a code view with an insert mode.',
};

/** Where `command`'s keys apply, in words. */
function where(command: Command): string {
  const { when } = command;
  if (command.vim === 'own') return "Vim's own key, in code views";
  const scopes = listOf(when?.scope);
  const except = when?.except ?? [];
  const parts: string[] = [];
  if (scopes.length > 0) {
    parts.push(`In ${listed(scopes.map(code))}`);
    if (except.length > 0) parts.push(`but not ${listed(except.map(code))}`);
  } else {
    parts.push(except.length > 0 ? `Anywhere but ${listed(except.map(code))}` : 'Anywhere');
  }
  let text = parts.join(' ');
  const modes = listOf(when?.mode);
  const inCode = scopes.length === 0 || scopes.some((scope) => modesOf(scope)[0] !== undefined);
  if (modes.length > 0 && inCode) text += `; in code views, only in ${listed(modes)} mode`;
  if (command.vim === 'motion') text += "; in code views, Vim's motion";
  return text;
}

/** A row of a Markdown table. */
function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** A Markdown table. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [tableRow(head), tableRow(head.map(() => '---')), ...rows.map(tableRow)];
}

/** Every command, feature by feature in their folders' order, each in its declaration order. */
function commandsIn(features: readonly Declarations[]): Command[] {
  return features.flatMap(commandsOf);
}

/** What a command with no key says in place of one: where it's found instead. */
function noKey(command: Command): string {
  if (!keyless(command)) return 'None';
  return command.bar
    ? 'None: in the app menu and the palette'
    : 'None: in its menu and the palette';
}

/** Key help's groups as macOS shows them: each command on macOS, with its keys there. */
function groupSections(commands: readonly Command[]): string[] {
  return groups.flatMap((group) => {
    const rows = commands
      .filter((command) => command.group === group && systemsOf(command).includes('mac'))
      .map((command) => {
        const keys = command.keys
          .map(specOf)
          .filter(({ on }) => on !== 'linux')
          .map(({ keys: each, on }) => `${code(form(each, 'mac'))}${on ? ' (macOS only)' : ''}`);
        return [command.label, keys.join(', ') || noKey(command), where(command), code(command.id)];
      });
    if (rows.length === 0) return [];
    return [`## ${group}`, '', ...table(['Action', 'Keys', 'Where', 'Command'], rows), ''];
  });
}

/** What the engine's scopes, the code views' and each feature's are. */
function scopeSection(features: readonly Declarations[]): string[] {
  const rows = [
    ...engineScopes.map((scope) => [code(scope), scopeMeanings[scope] ?? '']),
    ...codeScopes.map((scope) => [code(scope), scopeMeanings[scope] ?? '']),
    ...features.flatMap(({ feature, scopes }) =>
      scopes.map((scope) => [code(scope), `Named by ${code(feature)}.`]),
    ),
  ];
  const seconds = SEQUENCE_TIMEOUT / 1000;
  return [
    '## Where keys apply',
    '',
    'A key applies in a scope: the nearest part of the window around the focused element that names one, or `window`. A key for a scope beats one for anywhere, so the same chord can mean one thing in a comment box and another elsewhere.',
    '',
    ...table(['Scope', 'What it is'], rows),
    '',
    "In a code view, keys follow Vim's mode. In insert mode, and while Vim waits for the rest of a command (after a count or an operator), only chords are Lo's, and other keys go to Vim, but for the keys of Lo's commands that take a count, after a count alone in normal mode (see [Counts](#counts)). In a text field, typing and moving through the text are the field's.",
    '',
    `A key that starts one of Lo's sequences waits for the rest. In a code view it waits however long it takes, as Vim's own \`y\` and \`g\` do, and a key that doesn't go on with it goes to Vim after it, so \`y w\` still yanks a word. Anywhere else it waits up to ${seconds} s, and if the rest doesn't come it's dropped, and the next key counts on its own. A chord Lo runs drops the waiting key, as do \`Esc\`, focus leaving, a click and a tab switch. The status bar shows the keys waiting, after any count, as Vim shows a command it's waiting on the rest of.`,
    '',
    "`Tab` doesn't move focus out of a scope; only dialogs and forms keep the browser's `Tab`.",
    '',
  ];
}

/** The commands that take a count, and what one counts. */
function countSection(commands: readonly Command[]): string[] {
  const counting = commands.filter(
    (command) => command.count !== undefined && systemsOf(command).includes('mac'),
  );
  if (counting.length === 0) return [];
  const rows = counting.map((command) => [
    command.label,
    command.keys
      .map(specOf)
      .filter(({ on }) => on !== 'linux')
      .map(({ keys }) => code(form(keys, 'mac')))
      .join(', '),
    command.count ?? '',
    where(command),
    code(command.id),
  ]);
  const views = new Set<string>(codeScopes);
  const named = new Set(counting.flatMap((command) => listOf(command.when?.scope)));
  const scopes = [...named].filter((scope) => !views.has(scope));
  return [
    '## Counts',
    '',
    'Digits typed just before a key are a count, as in Vim, for the commands that take one: `3 e` marks three files viewed, and `1 e` one, where `e` alone clears a mark. Before any other key a count is dropped, and the key runs once; in a code view it goes on to Vim with the key, so `3 j` still moves three lines. `Esc` drops a count and does nothing else.',
    '',
    ...table(['Action', 'Keys', 'Counts', 'Where', 'Command'], rows),
    '',
    `In a code view the count is Vim's until one of these keys takes it, in normal mode only.${scopes.length > 0 ? ` Elsewhere digits are a count only in ${listed(scopes.map(code))}, where a command of the scope's own takes one, and a count waits for its key as a sequence's first key does.` : ''}`,
    '',
  ];
}

/** Keys on one system only, each in that system's form. */
function systemSection(commands: readonly Command[]): string[] {
  const rows = commands.flatMap((command) => {
    const on = systemsOf(command);
    const only = on.length === 1 ? on[0] : undefined;
    const specs = command.keys.map(specOf);
    return systems.flatMap((system) => {
      // A command on one system has all its keys there; one on both, those written for one.
      const keys = specs.filter((spec) =>
        only === undefined ? spec.on === system : only === system && (spec.on ?? system) === system,
      );
      if (keys.length === 0) return [];
      return [
        [
          command.label,
          keys.map((spec) => code(form(spec.keys, system))).join(', '),
          systemNames[system],
          where(command),
          code(command.id),
        ],
      ];
    });
  });
  const editing = linuxEditingKeys.map((keys) => code(form(keys, 'linux')));
  return [
    '## Keys for one system',
    '',
    "On Linux, Ctrl takes the place of `⌘` in every key, and Lo shows each system its keys in its own form: `⌘⇧P` is `Ctrl+Shift+P` on Linux. `⌃` is Ctrl on both, so Vim's `⌃o` is `Ctrl+O` on Linux.",
    '',
    ...(rows.length > 0
      ? [
          'These keys are on one system only:',
          '',
          ...table(['Action', 'Keys', 'On', 'Where', 'Command'], rows),
          '',
        ]
      : []),
    `On Linux, in a comment box in insert mode, and in a field inside a code view such as Vim's search, Lo never takes ${listed(editing, 'or')}: they keep their editing meanings.`,
    '',
  ];
}

/** Lo's keys that replace Vim's in code views, as `overVim` allows. */
function vimSection(commands: readonly Command[], vim: VimKeys): string[] {
  interface Row {
    command: Command;
    keys: string;
    systems: Set<System>;
    vim: Set<string>;
    /** The modes each scope meets Vim's keys in. */
    sites: Map<string, Set<Mode>>;
  }
  const rows = new Map<string, Row>();
  for (const { binding, site, vim: theirs } of vimMeetings(commands, vim)) {
    const { command } = binding;
    if (!command.overVim || site.mode === undefined) continue;
    const keys = writeStrokes(binding.strokes, site.system);
    const id = `${command.id} ${keys}`;
    let row = rows.get(id);
    if (!row) {
      row = { command, keys, systems: new Set(), vim: new Set(), sites: new Map() };
      rows.set(id, row);
    }
    row.systems.add(site.system);
    row.vim.add(theirs);
    let modes = row.sites.get(site.scope);
    if (!modes) {
      modes = new Set();
      row.sites.set(site.scope, modes);
    }
    modes.add(site.mode);
  }
  const cells = [...rows.values()].map((row) => {
    const both = row.systems.size > 1;
    const system: System = both || row.systems.has('mac') ? 'mac' : 'linux';
    const note = both ? '' : ` (${systemNames[system]})`;
    const sites = [...row.sites].map(([scope, modes]) => {
      const all = modesOf(scope).every((mode) => mode !== undefined && modes.has(mode));
      return all ? code(scope) : `${code(scope)} (${listed([...modes])})`;
    });
    return [
      `${code(form(row.keys, system))}${note}`,
      row.command.label,
      listed([...row.vim].map((each) => code(form(each, system)))),
      listed(sites),
      code(row.command.id),
    ];
  });
  const motions = commands.filter((command) => command.vim === 'motion');
  return [
    "## Keys over Vim's",
    '',
    `Code views (${listed(codeScopes.map(code))}) run Vim, and Lo leaves Vim's keys to it there, except these, which run Lo's command in place of Vim's key:`,
    '',
    ...(cells.length > 0
      ? table(['Keys', 'Action', "Vim's key", 'Where', 'Command'], cells)
      : ['None.']),
    '',
    ...(motions.length > 0
      ? [
          `In code views, Vim runs Lo's motions (${listed(motions.map((command) => command.label.toLowerCase()))}) under Lo's keys, so a count repeats them and they extend a selection in visual mode.`,
          '',
        ]
      : []),
  ];
}

/** The keys that open the keymap file, as the first of the command's default keys. */
function openKeymapKeys(commands: readonly Command[]): string {
  const key = commands.find((command) => command.id === 'keys.openKeymap')?.keys.map(specOf)[0];
  if (!key) throw new Error('keys.openKeymap has no key to write in the keymap file’s section.');
  return key.keys;
}

/** An example keymap file, which every command it names must have, and every line apply. */
const example = `# Open the command palette with ⌘K as well, as many apps do.
bind cmd+k keys.palette
# Esc no longer goes back to the middle view.
unbind esc keys.escape
# Y yanks to the end of the line.
vim normal Y y$`;

/** The keymap file's format, and how keys are written in it. */
function keymapSection(commands: readonly Command[]): string[] {
  const ids = new Set(commands.map((command) => command.id));
  const { errors } = parseKeymap(example, (id) => ids.has(id));
  if (errors.length > 0) {
    throw new Error(
      `The example keymap no longer applies: ${errors.map((error) => `line ${error.line}: ${error.message}`).join(' ')}`,
    );
  }
  const fn = keyNames.filter((name) => /^f\d+$/.test(name));
  const named = keyNames.filter((name) => !fn.includes(name));
  return [
    '## The keymap file',
    '',
    'Keys are remapped in `~/.config/lo/keymap` (`$XDG_CONFIG_HOME/lo/keymap` on Linux), a text file with one change on each line:',
    '',
    "- `bind <keys> <command>` adds keys to a command, where it applies. A line here beats Lo's own keys, and a later line an earlier one.",
    '- `unbind <keys>` takes keys from every command, and `unbind <keys> <command>` from that one.',
    "- `vim <mode> <keys> <what they do>` maps keys in code views' Vim, as Vim's `:nmap` does, both sides in Vim's notation (`<C-o>`, `<CR>`). The mode is `normal`, `visual` or `insert`.",
    '- `#` starts a comment.',
    '',
    '```',
    example,
    '```',
    '',
    "A line that can't be read or applied is reported with its number, and the others still apply. A `bind` doesn't apply when it names one of Vim's own keys, repeats a key the command already has, or would keep another command's key from running: one of the two being the start of the other where both apply.",
    '',
    `Lo watches the file, so a saved change applies within a second, with no restart, and key help (\`?\`) shows the new keys and the lines Lo can't use. To open the file, use the button in key help, the command palette or ${code(form(openKeymapKeys(commands), 'mac'))}: Lo opens it as text in your system's text editor, writing it first, with a header of comments, if there isn't one. Opening never runs anything, so Lo doesn't open a file that is executable, isn't a plain file (a folder, or an app a link leads to) or is over the limit below: key help says why, and has no button. The editor is the app for text whatever the file's name or contents, even through a link to a file named like a launcher or a web page: on Linux, the app \`xdg-mime query default text/plain\` names, started with \`gio launch\`. Without one of those, Lo says so and opens nothing. A link to a file in a dotfiles folder is followed. Lo reads a file of up to ${KEYMAP_SIZE_LIMIT / 1024 ** 2} MiB and lines of up to ${KEYMAP_LINE_LIMIT.toLocaleString('en')} characters; a longer line is reported and skipped, and a longer file isn't read. Nothing in the file is ever run.`,
    '',
    '### Writing keys',
    '',
    "Keys are written the same way in the keymap file and in Lo's code:",
    '',
    '- A chord joins modifiers and a key with `+`: `cmd+shift+p`. `cmd` is `⌘` on macOS and Ctrl on Linux, `ctrl` is `⌃` on macOS and Ctrl on Linux, `alt` is `⌥` (Alt) and `shift` is `⇧`.',
    '- A sequence separates its keys with spaces: `] f`, `g S`.',
    `- A key is one character, or one of ${named.map(code).join(', ')}, and ${code(fn[0] ?? '')} to ${code(fn.at(-1) ?? '')}. \`plus\` is \`+\`.`,
    "- A lone letter's case is its key: `G` is Shift and G, as is `shift+g`.",
    '',
  ];
}

/** docs/keys.md for `features`, before Prettier formats it. */
export function keysDoc(features: readonly Declarations[], vim: VimKeys = vimDefaults): string {
  const commands = commandsIn(features);
  return [
    "<!-- Written by `pnpm nx run desktop:codegen` from each feature's keys.ts in apps/desktop. Change those, not this file. -->",
    '',
    '# Keys',
    '',
    "Lo is keyboard first: every action has a key, but for a few done once in a while, which a menu and the command palette reach. These are its keys as it ships, from the commands each of its features declares. Keys are written as macOS shows them; on Linux, Ctrl takes the place of `⌘` (see [Keys for one system](#keys-for-one-system)). A sequence's keys are pressed one after another: `] f` is `]`, then `f`.",
    '',
    "Each command's id is what [the keymap file](#the-keymap-file) binds keys to.",
    '',
    ...groupSections(commands),
    ...scopeSection(features),
    ...countSection(commands),
    ...systemSection(commands),
    ...vimSection(commands, vim),
    ...keymapSection(commands),
  ].join('\n');
}

/** Whether `value` is what `defineCommands` returns. */
function isDeclarations(value: unknown): value is Declarations {
  return (
    typeof value === 'object' &&
    value !== null &&
    'feature' in value &&
    'commands' in value &&
    'scopes' in value
  );
}

/** Every feature's declarations, from the `keys.ts` in each feature's folder under `features`. */
export async function readFeatures(features: URL): Promise<Declarations[]> {
  const files = readdirSync(features, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => new URL(`${entry.name}/keys.ts`, features))
    .filter((file) => existsSync(file));
  const modules = await Promise.all(
    files.map(async (file): Promise<[string, Declarations]> => {
      const module: unknown = await import(file.href);
      const declared: unknown =
        typeof module === 'object' && module !== null ? Reflect.get(module, 'default') : undefined;
      if (!isDeclarations(declared)) {
        throw new Error(`${fileURLToPath(file)} doesn't export defineCommands(…) by default.`);
      }
      return [fileURLToPath(file), declared];
    }),
  );
  return checkDeclarations(Object.fromEntries(modules));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const features = await readFeatures(new URL('../src/features/', import.meta.url));
  writeFileSync(new URL('../../../docs/keys.md', import.meta.url), keysDoc(features));
}
