import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSync, Visitor } from 'oxc-parser';
import { expect, test } from 'vitest';

import plugin, {
  APOSTROPHE_MESSAGE,
  loSubject,
  MESSAGE,
  SCROLL_MESSAGE,
  SUBJECT_MESSAGE,
  subjectEntry,
  TITLE_MESSAGE,
} from './plugin.ts';
import { LO_SUBJECTS } from './subjects.ts';

/** The repository's root. */
const ROOT = join(import.meta.dirname, '..', '..');

/** The source of each node `lo/no-returned-never` reports in `source`, a TypeScript file. */
function reported(source: string): string[] {
  const found: string[] = [];
  const rule = plugin.rules['no-returned-never'].create({
    report: ({ node, message }) => {
      expect(message).toBe(MESSAGE);
      const start: unknown = Reflect.get(node, 'start');
      const end: unknown = Reflect.get(node, 'end');
      found.push(
        typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '',
      );
    },
  });
  const { program } = parseSync('file.ts', source);
  new Visitor({
    ReturnStatement: (node) => rule.ReturnStatement(node),
    ArrowFunctionExpression: (node) => rule.ArrowFunctionExpression(node),
    AssignmentExpression: (node) => rule.AssignmentExpression(node),
    VariableDeclarator: (node) => rule.VariableDeclarator(node),
    YieldExpression: (node) => rule.YieldExpression(node),
    ConditionalExpression: (node) => rule.ConditionalExpression(node),
    LogicalExpression: (node) => rule.LogicalExpression(node),
    Property: (node) => rule.Property(node),
    ArrayExpression: (node) => rule.ArrayExpression(node),
  }).visit(program);
  return found;
}

test('returning a value checked as never is refused', () => {
  const source = `
    type Kind = 'a' | 'b';
    function name(kind: Kind): string {
      switch (kind) {
        case 'a':
          return 'A';
        case 'b':
          return 'B';
        default:
          return kind satisfies never;
      }
    }
    const parenthesized = (kind: never) => {
      return (kind satisfies never);
    };
    const arrow = (kind: never) => kind satisfies never;
  `;
  expect(reported(source)).toEqual([
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
  ]);
});

test('assigning or yielding a value checked as never is refused', () => {
  const source = `
    type Kind = 'a' | 'b';
    function name(kind: Kind): string {
      let found = 'none';
      switch (kind) {
        case 'a':
          found = 'A';
          break;
        case 'b':
          found = 'B';
          break;
        default:
          found = kind satisfies never;
      }
      return found;
    }
    function declared(kind: never): unknown {
      const kept = (kind satisfies never);
      return kept;
    }
    const held: { kind?: unknown } = {};
    function into(kind: never): void {
      held.kind = kind satisfies never;
    }
    function* each(kinds: never[]): Generator<unknown> {
      for (const kind of kinds) yield kind satisfies never;
    }
  `;
  expect(reported(source)).toEqual([
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
  ]);
});

test('a value checked as never is refused through a type assertion or a non-null assertion', () => {
  const source = `
    function asserted(kind: never): string {
      return kind satisfies never as string;
    }
    function nonNull(kind: never): string {
      return (kind satisfies never)!;
    }
    function angled(kind: never): string {
      return <string>(kind satisfies never);
    }
    const both = (kind: never) => ((kind satisfies never) as string | undefined)!;
  `;
  expect(reported(source)).toEqual([
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
  ]);
});

test('a value checked as never is refused as a branch, or as a member of an object or array', () => {
  const source = `
    function branch(kind: never, known: boolean): string {
      return known ? 'known' : (kind satisfies never);
    }
    function first(kind: never, known: boolean): unknown {
      const chosen = known ? (kind satisfies never) : 'unknown';
      return chosen;
    }
    const either = (kind: never, other?: string) => other ?? (kind satisfies never);
    function member(kind: never): { kind: unknown } {
      return { kind: kind satisfies never };
    }
    function shorthand(kind: never): object {
      return { found: [1, kind satisfies never] };
    }
    function spread(kinds: never[]): unknown[] {
      return [...(kinds satisfies never)];
    }
  `;
  expect(reported(source)).toEqual([
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
    'kind satisfies never',
    'kinds satisfies never',
  ]);
});

test('checking a value as never then throwing or falling back is allowed', () => {
  const source = `
    function name(kind: 'a'): string {
      switch (kind) {
        case 'a':
          return 'A';
        default:
          throw new Error(\`a kind Lo doesn't know: \${JSON.stringify(kind satisfies never)}\`);
      }
    }
    function label(kind: 'a'): string {
      switch (kind) {
        case 'a':
          return 'A';
        default:
          kind satisfies never;
          return 'unknown';
      }
    }
    const known = (kind: 'a') => kind satisfies 'a';
    const checked = known('a') satisfies 'a';
    let last: string = checked;
    last = checked satisfies string;
    function* kinds(): Generator<'a'> {
      yield checked satisfies 'a';
    }
    // Named in an error, or handed to a call: the forms for saying what the value was.
    function named(kind: never): never {
      console.error("a kind Lo doesn't know", kind satisfies never);
      throw new Error(String(kind satisfies never));
    }
    const picked = (known: boolean) => (known ? (checked satisfies 'a') : 'b');
    const kept = { checked: checked satisfies 'a', all: [checked satisfies string] };
  `;
  expect(reported(source)).toEqual([]);
});

/** The source of each call `lo/no-scroll-into-view` reports in `source`, a TypeScript file. */
function scrolls(source: string): string[] {
  const found: string[] = [];
  const rule = plugin.rules['no-scroll-into-view'].create({
    report: ({ node, message }) => {
      expect(message).toBe(SCROLL_MESSAGE);
      const start: unknown = Reflect.get(node, 'start');
      const end: unknown = Reflect.get(node, 'end');
      found.push(
        typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '',
      );
    },
  });
  const { program } = parseSync('file.ts', source);
  new Visitor({ CallExpression: (node) => rule.CallExpression(node) }).visit(program);
  return found;
}

test("an element's scrollIntoView is refused, however it's called, and CodeMirror's effect isn't", () => {
  const source = `
    row.scrollIntoView({ block: 'nearest' });
    shown.current?.scrollIntoView?.({ block: 'nearest' });
    element['scrollIntoView']();
    element.scrollIntoViewIfNeeded();
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    view.dispatch({ selection, scrollIntoView: true });
    if (typeof row?.scrollIntoView === 'function') reveal(row);
  `;
  expect(scrolls(source)).toEqual([
    "row.scrollIntoView({ block: 'nearest' })",
    "shown.current?.scrollIntoView?.({ block: 'nearest' })",
    "element['scrollIntoView']()",
    'element.scrollIntoViewIfNeeded()',
  ]);
});

/**
 * The source of each string `lo/no-lo-subject` reports in `source`, a file at `path`, letting
 * through those `known` lists.
 */
function subjects(
  source: string,
  path = join(ROOT, 'apps/desktop/src/file.tsx'),
  known: ReadonlySet<string> = new Set(),
): string[] {
  const found: string[] = [];
  const text = (node: unknown): string => {
    const start: unknown = Reflect.get(Object(node), 'start');
    const end: unknown = Reflect.get(Object(node), 'end');
    return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';
  };
  const rule = loSubject(known).create({
    report: ({ node, message }) => {
      expect(message).toBe(SUBJECT_MESSAGE);
      found.push(text(node));
    },
    filename: path,
    sourceCode: { getText: text },
  });
  const { program } = parseSync(path, source);
  new Visitor({
    CallExpression: (node) => rule.CallExpression(node),
    Literal: (node) => rule.Literal(node),
    TemplateLiteral: (node) => rule.TemplateLiteral(node),
    JSXText: (node) => rule.JSXText(node),
  }).visit(program);
  return found;
}

test('a string the reader may see that makes Lo its subject is refused, in any form', () => {
  const source = `
    const said = 'Lo couldn’t send the comment.';
    const why = \`Lo can’t open \${path}\`;
    const label = <span title="Lo is reading the file">
      Lo is checking
    </span>;
    throw new IpcError('failed', "Lo couldn't read the comments.");
    throw new Error(\`Lo doesn't know why: \${String(why)}\`);
    giveUp.abort(new DOMException('Lo is quitting', 'AbortError'));
  `;
  expect(subjects(source)).toEqual([
    "'Lo couldn’t send the comment.'",
    '`Lo can’t open ${path}`',
    '"Lo is reading the file"',
    `
      Lo is checking
    `,
    '"Lo couldn\'t read the comments."',
    "`Lo doesn't know why: ${String(why)}`",
    "'Lo is quitting'",
  ]);
});

test('a version, another subject, a log’s message and a listed string are let through', () => {
  const path = join(ROOT, 'apps/desktop/src/file.tsx');
  const source = `
    const offer = \`Lo \${version} is available\`;
    const version = 'Lo 0.9.0';
    const named = 'Lo Dev';
    const own = 'Lo’s own dialog';
    const title = 'Couldn’t send the comment';
    console.error("Lo couldn't copy the path:", error);
    log(\`Lo couldn't check the setting \${key}:\`, error);
    this.#log('Lo is quitting');
    work.log('Lo couldn’t highlight a file:', error);
    const kept = 'Lo still says this';
    const label = <span>
      Lo still says this too
    </span>;
  `;
  const known = new Set([
    "apps/desktop/src/file.tsx: 'Lo still says this'",
    'apps/desktop/src/file.tsx: Lo still says this too',
  ]);
  expect(subjectEntry(path, "'Lo still says this'")).toBe(
    "apps/desktop/src/file.tsx: 'Lo still says this'",
  );
  expect(subjects(source, path, known)).toEqual([]);
  // Listed for another file, it's refused here.
  expect(subjects(source, join(ROOT, 'apps/desktop/src/other.tsx'), known)).toHaveLength(2);
});

/** The source of each native `title` `lo/no-native-title` reports in `source`, a file at `path`. */
function titles(source: string, path = join(ROOT, 'packages/desktop/ui/src/file.tsx')): string[] {
  const found: string[] = [];
  const rule = plugin.rules['no-native-title'].create({
    report: ({ node, message }) => {
      expect(message).toBe(TITLE_MESSAGE);
      const start: unknown = Reflect.get(node, 'start');
      const end: unknown = Reflect.get(node, 'end');
      found.push(
        typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '',
      );
    },
    filename: path,
  });
  const { program } = parseSync(path, source);
  new Visitor({
    JSXOpeningElement: (node) => rule.JSXOpeningElement(node),
    AssignmentExpression: (node) => rule.AssignmentExpression(node),
    Property: (node) => rule.Property(node),
    CallExpression: (node) => rule.CallExpression(node),
  }).visit(program);
  return found;
}

test('a native title is refused, on an element, as a property or as an attribute', () => {
  const source = `
    const path = <span className="lo-path" title={path}>{path}</span>;
    const named = <svg role="img" aria-label="Added" title="Added" />;
    ball.title = 'Viewed';
    row.dataset.tip = 'Viewed';
    ball.setAttribute('title', 'Viewed');
    ball.setAttributeNS(null, 'title', 'Viewed');
    ball.setAttribute('aria-label', 'title');
  `;
  expect(titles(source)).toEqual([
    'title={path}',
    'title="Added"',
    "ball.title = 'Viewed'",
    "ball.setAttribute('title', 'Viewed')",
    "ball.setAttributeNS(null, 'title', 'Viewed')",
  ]);
});

test('a native title is refused spread on an element, or among a decoration’s attributes', () => {
  const source = `
    const spread = <span {...{ title }} />;
    const named = <span {...{ 'title': path, id }} />;
    const rest = <span {...rest} />;
    const component = <Dialog {...{ title }} />;
    const mark = Decoration.mark({ class: 'lo-hit', attributes: { title: why } });
    const line = Decoration.line({ attributes: { 'aria-label': why } });
    const data = { attributes: [], title: 'Kept' };
  `;
  expect(titles(source)).toEqual(['title', "'title': path", 'title: why']);
});

test('a component’s own title, the window’s and one outside the desktop app are let through', () => {
  const source = `
    const dialog = <Dialog title="Delete comment?" />;
    const problem = <Problem layout="inline" title="Couldn’t send the comment" />;
    const row = <ui.Row title="One" />;
    document.title = 'Lo';
  `;
  expect(titles(source)).toEqual([]);
  expect(titles('const a = <span title="x" />;', join(ROOT, 'apps/site/src/file.tsx'))).toEqual([]);
  expect(titles('const a = <span title="x" />;', join(ROOT, 'apps/desktop/src/file.tsx'))).toEqual([
    'title="x"',
  ]);
});

/** The source of each string `lo/no-straight-apostrophe` reports in `source`, a file at `path`. */
function straight(source: string, path = join(ROOT, 'apps/desktop/src/file.tsx')): string[] {
  const found: string[] = [];
  const text = (node: unknown): string => {
    const start: unknown = Reflect.get(Object(node), 'start');
    const end: unknown = Reflect.get(Object(node), 'end');
    return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';
  };
  const rule = plugin.rules['no-straight-apostrophe'].create({
    report: ({ node, message }) => {
      expect(message).toBe(APOSTROPHE_MESSAGE);
      found.push(text(node));
    },
    filename: path,
  });
  const { program } = parseSync(path, source);
  new Visitor({
    CallExpression: (node) => rule.CallExpression(node),
    NewExpression: (node) => rule.NewExpression(node),
    BinaryExpression: (node) => rule.BinaryExpression(node),
    SwitchCase: (node) => rule.SwitchCase(node),
    ImportDeclaration: (node) => rule.ImportDeclaration(node),
    ImportExpression: (node) => rule.ImportExpression(node),
    ExportAllDeclaration: (node) => rule.ExportAllDeclaration(node),
    ExportNamedDeclaration: (node) => rule.ExportNamedDeclaration(node),
    Property: (node) => rule.Property(node),
    JSXElement: (node) => rule.JSXElement(node),
    Literal: (node) => rule.Literal(node),
    TemplateLiteral: (node) => rule.TemplateLiteral(node),
    JSXText: (node) => rule.JSXText(node),
  }).visit(program);
  return found;
}

test('a straight apostrophe the reader may see is refused, in any form', () => {
  const source = `
    const said = "Couldn't send the comment";
    const why = \`\${login}'s token isn’t valid\`;
    const label = <p>It's over the limit</p>;
    throw new IpcError('missing', "There's no tab with that id.");
    const plural = "The pull requests' checks";
    const last = <p>Open Settings' list</p>;
  `;
  expect(straight(source)).toEqual([
    '"Couldn\'t send the comment"',
    "`${login}'s token isn’t valid`",
    "It's over the limit",
    '"There\'s no tab with that id."',
    '"The pull requests\' checks"',
    "Open Settings' list",
  ]);
});

test('code keeps its straight apostrophes, and so does text from elsewhere', () => {
  const source = `
    import { thing } from './it\\'s.ts';
    const curly = 'Couldn’t send the comment';
    const quoted = "Run \`git config user.name 'Ravi'\` first";
    const typed = <p>Run <code>echo 'it's'</code> or <kbd>don't</kbd></p>;
    const id = 'diff.markViewed';
    const byName = { "isn't": 'not' };
    const later = await import('./it\\'s.ts');
    const marks = /(?<!\\p{L})'/u;
    if (message.includes("couldn't find remote ref")) refNotFound();
    if (has('Failed to connect', "Couldn't connect")) offline();
    if (new RegExp("can't lock ref").test(message)) locked();
    if (said === "doesn't exist") missing();
    switch (said) {
      case "isn't a repo":
        break;
    }
    const plain = line.replace("it's", 'it’s');
    console.error("Lo couldn't copy the path:", error);
    const quotes = "Pushes to 'releases' are refused";
    const project = \`<!-- Lo's project, with nothing else of the checkout's. -->\`;
  `;
  expect(straight(source)).toEqual([]);
  // What a replace puts in its place is its own.
  expect(straight("const text = line.replace('x', \"it's\");")).toEqual(['"it\'s"']);
  // Outside the desktop app, nothing is checked.
  expect(straight('const said = "Couldn\'t send";', join(ROOT, 'scripts/file.ts'))).toEqual([]);
});

/** Where the desktop app's strings are: its source, and its packages'. */
const SOURCES = [
  'apps/desktop/src',
  ...readdirSync(join(ROOT, 'packages/desktop'))
    .map((name) => `packages/desktop/${name}/src`)
    .filter((folder) => existsSync(join(ROOT, folder))),
];

/** Every source file under `folder` that `lo/no-lo-subject` checks: not a test's, nor built. */
function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      const skipped = ['node_modules', 'dist', 'test', 'e2e', '.tsbuild'];
      return skipped.includes(entry.name) ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('the strings that still make Lo their subject are listed, and only they', () => {
  const found = new Set(
    SOURCES.flatMap((folder) => sourceFiles(join(ROOT, folder))).flatMap((path) =>
      subjects(readFileSync(path, 'utf8'), path).map((text) => subjectEntry(path, text)),
    ),
  );
  // A listed string no longer found was rewritten: take it off the list. One found but not listed
  // is new: `lo/no-lo-subject` refuses it, so rewrite it.
  expect({
    gone: LO_SUBJECTS.filter((each) => !found.has(each)),
    unlisted: [...found].filter((each) => !LO_SUBJECTS.includes(each)),
    repeated: LO_SUBJECTS.filter((each, index) => LO_SUBJECTS.indexOf(each) !== index),
  }).toEqual({ gone: [], unlisted: [], repeated: [] });
});
