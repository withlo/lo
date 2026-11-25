/**
 * Lo's own lint rules, which oxlint loads from `.oxlintrc.json` as the `lo` plugin.
 *
 * `lo/no-returned-never` refuses handing on `value satisfies never`: returning it, an arrow
 * function whose body is it, assigning it, declaring a variable with it, yielding it, or making it
 * a branch of a conditional or logical expression, or a member of an object or array, and so part
 * of what's handed on. It looks through parentheses, `as`, `<T>` and `!`. In a switch's `default`,
 * the check fails to compile when a member of the union isn't handled, but a value outside the
 * union still gets there at runtime, and handing it on passes it off as whatever the function
 * returns, the variable holds or the generator yields. Check the value with `value satisfies
 * never;`, then throw an error naming it, or, for a value that can come from outside Lo, such as
 * GitHub's answer or what Lo saved, give a safe answer. A call's argument isn't refused, since
 * naming the value in an error (`JSON.stringify(value satisfies never)`) is the intended form.
 *
 * `lo/no-scroll-into-view` refuses an element's `scrollIntoView`: see {@link noScrollIntoView}.
 *
 * `lo/no-lo-subject` refuses a string the reader may see that starts with "Lo ": see
 * {@link noLoSubject}.
 *
 * `lo/no-native-title` refuses a native tooltip, a DOM element's `title`: see {@link noNativeTitle}.
 *
 * `lo/no-straight-apostrophe` refuses a straight apostrophe the reader may see: see
 * {@link noStraightApostrophe}.
 *
 * `lo/no-inline-icon` refuses an icon drawn as an `<svg>` of its own, or from `lucide` outside the
 * list of Lo's icons: see {@link noInlineIcon}.
 */

import { join, relative } from 'node:path';

import { LO_SUBJECTS } from './subjects.ts';

/** A syntax tree node, as oxlint hands one to a rule. */
interface AstNode {
  readonly type: string;
}

/** What a rule reports through, and the file it's checking, where it needs them. */
interface Context {
  report(diagnostic: { node: AstNode; message: string }): void;
  readonly filename?: string;
  readonly sourceCode?: { getText(node: AstNode): string };
}

export const MESSAGE =
  'This hands on a value outside its union, as an answer, a variable or what a generator yields. Check it with `value satisfies never;`, then throw an error naming it, or give a safe answer for a value from outside Lo.';

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  );
}

/** Wrappers that leave the value they hold as it is: parentheses, `as`, `<T>` and `!`. */
const SAME_VALUE = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
]);

/** `node` without the wrappers around it that leave its value as it is. */
function unwrapped(node: unknown): unknown {
  let at = node;
  while (isNode(at) && SAME_VALUE.has(at.type)) at = Reflect.get(at, 'expression');
  return at;
}

/** `node`, when it's `value satisfies never`, however wrapped. */
function neverCheck(node: unknown): AstNode | undefined {
  const at = unwrapped(node);
  if (!isNode(at) || at.type !== 'TSSatisfiesExpression') return undefined;
  const type: unknown = Reflect.get(at, 'typeAnnotation');
  return isNode(type) && type.type === 'TSNeverKeyword' ? at : undefined;
}

export const noReturnedNever = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow returning, assigning or yielding `value satisfies never`, which hands the value on.',
    },
  },
  create(context: Context) {
    /** Reports `value` when it's a value checked as never. */
    const check = (value: unknown): void => {
      const found = neverCheck(value);
      if (found) context.report({ node: found, message: MESSAGE });
    };
    return {
      ReturnStatement(node: AstNode): void {
        check(Reflect.get(node, 'argument'));
      },
      ArrowFunctionExpression(node: AstNode): void {
        check(Reflect.get(node, 'body'));
      },
      AssignmentExpression(node: AstNode): void {
        check(Reflect.get(node, 'right'));
      },
      VariableDeclarator(node: AstNode): void {
        check(Reflect.get(node, 'init'));
      },
      YieldExpression(node: AstNode): void {
        check(Reflect.get(node, 'argument'));
      },
      ConditionalExpression(node: AstNode): void {
        check(Reflect.get(node, 'consequent'));
        check(Reflect.get(node, 'alternate'));
      },
      LogicalExpression(node: AstNode): void {
        check(Reflect.get(node, 'left'));
        check(Reflect.get(node, 'right'));
      },
      Property(node: AstNode): void {
        check(Reflect.get(node, 'value'));
      },
      ArrayExpression(node: AstNode): void {
        const elements: unknown = Reflect.get(node, 'elements');
        if (!Array.isArray(elements)) return;
        for (const element of elements) {
          check(
            isNode(element) && element.type === 'SpreadElement'
              ? Reflect.get(element, 'argument')
              : element,
          );
        }
      },
    };
  },
};

export const SCROLL_MESSAGE =
  'This scrolls every box around the element, the window among them, and the window never scrolls. Use `reveal(element, { block })` from `@lo/ui`, which scrolls the pane the element is in and nothing else.';

/** The name of what `node`, a member expression, reads, when it's a plain name or a string. */
function memberName(node: unknown): string | undefined {
  if (!isNode(node) || node.type !== 'MemberExpression') return undefined;
  const property: unknown = Reflect.get(node, 'property');
  if (!isNode(property)) return undefined;
  if (!Reflect.get(node, 'computed') && property.type === 'Identifier') {
    const name: unknown = Reflect.get(property, 'name');
    return typeof name === 'string' ? name : undefined;
  }
  const value: unknown = Reflect.get(property, 'value');
  return property.type === 'Literal' && typeof value === 'string' ? value : undefined;
}

/**
 * `lo/no-scroll-into-view` refuses calling an element's `scrollIntoView` or
 * `scrollIntoViewIfNeeded`, which scroll every box around the element, the window's shell among
 * them. `reveal()` scrolls the element's own pane. CodeMirror's `EditorView.scrollIntoView`, an
 * effect that scrolls the editor alone, is left alone.
 */
export const noScrollIntoView = {
  meta: {
    type: 'problem',
    docs: {
      description: "Disallow an element's scrollIntoView, which scrolls the window; use reveal().",
    },
  },
  create(context: Context) {
    return {
      CallExpression(node: AstNode): void {
        const callee: unknown = Reflect.get(node, 'callee');
        const name = memberName(callee);
        if (name !== 'scrollIntoView' && name !== 'scrollIntoViewIfNeeded') return;
        const object: unknown = isNode(callee) ? Reflect.get(callee, 'object') : undefined;
        if (isNode(object) && object.type === 'Identifier') {
          if (Reflect.get(object, 'name') === 'EditorView') return;
        }
        context.report({ node, message: SCROLL_MESSAGE });
      },
    };
  },
};

export const SUBJECT_MESSAGE =
  'This string makes Lo its subject. Name the reader’s thing instead: “Couldn’t send the comment”, not “Lo couldn’t send your comment”. Lo is the subject only to tell it apart from GitHub or another app, and “Lo 0.9.0” names a version.';

/**
 * "Lo " and a word in lower case at the start of a string, as a sentence starts: not a version,
 * "Lo 0.9.0 is available", nor a name, "Lo Dev".
 */
const LO_SUBJECT = /^Lo [a-z]/;

/** What logs a message, which no one reads but a developer, by name. */
const UNREAD_CALLS = new Set(['log', 'warn', 'debug', 'trace', 'info']);

/** The repository's root, which {@link LO_SUBJECTS}' paths are relative to. */
const ROOT = join(import.meta.dirname, '..', '..');

/** Where the desktop app's strings are, relative to {@link ROOT}: its source, and its packages'. */
const DESKTOP = /^(apps\/desktop\/src|packages\/desktop\/[^/]+\/src)\//;

/** A string `lo/no-lo-subject` finds, as {@link LO_SUBJECTS} lists it: its file, then its first line. */
export function subjectEntry(filename: string, source: string): string {
  return `${relative(ROOT, filename)}: ${source.trim().split('\n')[0] ?? ''}`;
}

/** The name `node` calls: a plain name, or the last part of a member or private name. */
function calleeName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Identifier') {
    const name: unknown = Reflect.get(node, 'name');
    return typeof name === 'string' ? name : undefined;
  }
  if (node.type !== 'MemberExpression') return undefined;
  const property: unknown = Reflect.get(node, 'property');
  if (isNode(property) && property.type === 'PrivateIdentifier') {
    const name: unknown = Reflect.get(property, 'name');
    return typeof name === 'string' ? name : undefined;
  }
  return memberName(node);
}

/** Whether `node`, a member expression, reads from `console`. */
function onConsole(node: unknown): boolean {
  if (!isNode(node) || node.type !== 'MemberExpression') return false;
  const object: unknown = Reflect.get(node, 'object');
  return (
    isNode(object) && object.type === 'Identifier' && Reflect.get(object, 'name') === 'console'
  );
}

/** Where `node` starts and ends in its file. */
function spanOf(node: AstNode): [number, number] {
  const start: unknown = Reflect.get(node, 'start');
  const end: unknown = Reflect.get(node, 'end');
  return [typeof start === 'number' ? start : 0, typeof end === 'number' ? end : 0];
}

/** What a string the reader may see says, as a rule over them is handed it. */
interface Said {
  /** The node it's in: a string or template literal, or JSX text. */
  readonly node: AstNode;
  /** Its text: each part of a template literal, between what's put in it, in order. */
  readonly parts: readonly string[];
}

/**
 * The strings the reader may see in the desktop app, its source's and its packages', handed to
 * `check` once each: a string or template literal, or JSX text. A log call's message (`console.*`,
 * and anything called `log`, `warn`, `debug`, `trace` or `info`) is left out, since only a
 * developer reads it. An error's message isn't: `describe` puts one on screen.
 */
function readerStrings(context: Context, check: (said: Said) => void) {
  /** The spans of log calls' arguments, which only a developer reads. */
  const unread: [number, number][] = [];
  const { filename } = context;
  const desktop = filename === undefined || DESKTOP.test(relative(ROOT, filename));
  const hand = (node: AstNode, parts: readonly unknown[]): void => {
    if (!desktop || !parts.every((part) => typeof part === 'string')) return;
    const [start, end] = spanOf(node);
    if (unread.some(([from, to]) => start >= from && end <= to)) return;
    check({ node, parts });
  };
  return {
    CallExpression(node: AstNode): void {
      const callee: unknown = Reflect.get(node, 'callee');
      const name = calleeName(callee);
      if (!onConsole(callee) && (name === undefined || !UNREAD_CALLS.has(name))) return;
      const args: unknown = Reflect.get(node, 'arguments');
      if (!Array.isArray(args)) return;
      for (const arg of args) if (isNode(arg)) unread.push(spanOf(arg));
    },
    Literal(node: AstNode): void {
      const value: unknown = Reflect.get(node, 'value');
      if (typeof value === 'string') hand(node, [value]);
    },
    TemplateLiteral(node: AstNode): void {
      const quasis: unknown = Reflect.get(node, 'quasis');
      if (!Array.isArray(quasis)) return;
      hand(
        node,
        quasis.map((quasi: unknown) => {
          const value: unknown = isNode(quasi) ? Reflect.get(quasi, 'value') : undefined;
          return typeof value === 'object' && value !== null
            ? Reflect.get(value, 'cooked')
            : undefined;
        }),
      );
    },
    JSXText(node: AstNode): void {
      const value: unknown = Reflect.get(node, 'value');
      if (typeof value === 'string') hand(node, [value.trimStart()]);
    },
  };
}

/**
 * `lo/no-lo-subject` refuses a string the reader may see that starts with "Lo " and a word in lower
 * case: a string or template literal, or JSX text. Lo isn't the subject of what it says
 * (`design/writing.md`). A version, "Lo 0.9.0", and a name, "Lo Dev", are left alone, and so is a
 * log call's message, which only a developer reads. It checks the desktop app's strings, as
 * {@link readerStrings} finds them, and lets through those `known` lists, by {@link subjectEntry}.
 */
export function loSubject(known: ReadonlySet<string>) {
  return {
    meta: {
      type: 'suggestion',
      docs: { description: 'Refuse a string the reader may see that makes Lo its subject.' },
    },
    create(context: Context) {
      const { filename, sourceCode } = context;
      return readerStrings(context, ({ node, parts }) => {
        if (!LO_SUBJECT.test(parts[0] ?? '')) return;
        if (filename !== undefined && sourceCode !== undefined) {
          if (known.has(subjectEntry(filename, sourceCode.getText(node)))) return;
        }
        context.report({ node, message: SUBJECT_MESSAGE });
      });
    },
  };
}

export const APOSTROPHE_MESSAGE =
  'This string has a straight apostrophe the reader may see. Write it curly: “can’t”, “GitHub’s”. Straight ones are only for code.';

/** A straight apostrophe between two letters, as in "can't" or "GitHub's". */
const STRAIGHT = /\p{L}'\p{L}/u;

/** A plural's straight apostrophe, after an "s" that ends a word, as in "Settings' list". */
const PLURAL = /\p{L}s'(?=[\s.,;:!?)]|$)/u;

/** A straight quote that opens a quotation, before a letter and after none: "'main'". */
const OPENS = /(?<![\p{L}\p{N}])'(?=\p{L})/u;

/** Code a string holds between backticks, as in "Run `git config user.name 'Ravi'`". */
const IN_BACKTICKS = /`[^`]*`/g;

/** A comment in markup, `<!-- … -->`, which is a file's own text, as a project file Lo writes. */
const IN_MARKUP_COMMENTS = /<!--[\s\S]*?-->/g;

/**
 * Whether `text` has a straight apostrophe: in a word, or after a plural. A plural's is looked for
 * only in text that quotes nothing with straight quotes, where its closing quote would look the
 * same, so "Settings' list" is refused, and "the 'rules' list" isn't.
 */
function hasStraight(text: string): boolean {
  return STRAIGHT.test(text) || (PLURAL.test(text) && !OPENS.test(text));
}

/** The elements whose text is code: what's typed, or what a program wrote. */
const CODE_ELEMENTS = new Set(['code', 'kbd', 'pre', 'samp']);

/** The name of the element `node`, a JSX element, opens with, when it's a plain one. */
function elementName(node: AstNode): string | undefined {
  const opening: unknown = Reflect.get(node, 'openingElement');
  const name: unknown = isNode(opening) ? Reflect.get(opening, 'name') : undefined;
  if (!isNode(name) || name.type !== 'JSXIdentifier') return undefined;
  const value: unknown = Reflect.get(name, 'name');
  return typeof value === 'string' ? value : undefined;
}

/**
 * What looks for text in other text, or compares with it, by name: a string handed to one is the
 * other text's, as it's written, as in `message.includes("couldn't find remote ref")`.
 */
const LOOKS_FOR = new Set([
  'endsWith',
  'has',
  'includes',
  'indexOf',
  'lastIndexOf',
  'match',
  'matchAll',
  'RegExp',
  'search',
  'startsWith',
  'test',
]);

/** What looks for its first argument only: what it puts in its place is its own. */
const LOOKS_FOR_FIRST = new Set(['replace', 'replaceAll', 'split']);

/** The arguments of `node`, a call or `new`, that are text it looks for, if it looks for any. */
function soughtIn(node: AstNode): unknown[] {
  const name = calleeName(Reflect.get(node, 'callee'));
  const args: unknown = Reflect.get(node, 'arguments');
  if (name === undefined || !Array.isArray(args)) return [];
  if (LOOKS_FOR.has(name)) return args;
  return LOOKS_FOR_FIRST.has(name) ? args.slice(0, 1) : [];
}

/** The operators that compare two values. */
const COMPARES = new Set(['===', '!==', '==', '!=']);

/**
 * `lo/no-straight-apostrophe` refuses a straight apostrophe between two letters in a string the
 * reader may see, as {@link readerStrings} finds them, or after a plural: "can't" is written
 * "can’t", and "Settings' list" "Settings’ list" (`design/writing.md`). A plural's is let through in
 * text that quotes with straight quotes, where it can't be told from a closing quote. Code keeps its
 * straight ones, so it leaves alone what's between backticks in a string, the text of a `<code>`,
 * `<kbd>`, `<pre>` or `<samp>`, a module's name, an object's key, a comment in markup, which is a
 * file's own text, and text from elsewhere that Lo looks for or compares with, as git or a server
 * writes it: an argument of `includes`, `has`, `startsWith`, `test` and the like, either side of
 * `===`, and a `case`. What's put in a template literal counts as a word, so `${name}'s` is refused
 * too.
 */
export const noStraightApostrophe = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Refuse a straight apostrophe in a string the reader may see.' },
  },
  create(context: Context) {
    /** The spans of code: elements whose text is code, and text from elsewhere. */
    const code: [number, number][] = [];
    const isCode = (node: unknown): void => {
      if (isNode(node)) code.push(spanOf(node));
    };
    const strings = readerStrings(context, ({ node, parts }) => {
      const [start, end] = spanOf(node);
      if (code.some(([from, to]) => start >= from && end <= to)) return;
      const text = parts.join('x').replaceAll(IN_BACKTICKS, '').replaceAll(IN_MARKUP_COMMENTS, '');
      if (!hasStraight(text)) return;
      context.report({ node, message: APOSTROPHE_MESSAGE });
    });
    return {
      ...strings,
      CallExpression(node: AstNode): void {
        strings.CallExpression(node);
        for (const arg of soughtIn(node)) isCode(arg);
      },
      NewExpression(node: AstNode): void {
        for (const arg of soughtIn(node)) isCode(arg);
      },
      BinaryExpression(node: AstNode): void {
        if (!COMPARES.has(String(Reflect.get(node, 'operator')))) return;
        isCode(Reflect.get(node, 'left'));
        isCode(Reflect.get(node, 'right'));
      },
      SwitchCase(node: AstNode): void {
        isCode(Reflect.get(node, 'test'));
      },
      ImportDeclaration(node: AstNode): void {
        isCode(Reflect.get(node, 'source'));
      },
      ImportExpression(node: AstNode): void {
        isCode(Reflect.get(node, 'source'));
      },
      ExportAllDeclaration(node: AstNode): void {
        isCode(Reflect.get(node, 'source'));
      },
      ExportNamedDeclaration(node: AstNode): void {
        isCode(Reflect.get(node, 'source'));
      },
      Property(node: AstNode): void {
        isCode(Reflect.get(node, 'key'));
      },
      JSXElement(node: AstNode): void {
        const name = elementName(node);
        if (name !== undefined && CODE_ELEMENTS.has(name)) code.push(spanOf(node));
      },
    };
  },
};

/** `lo/no-lo-subject`, letting through the strings that remain, which {@link LO_SUBJECTS} lists. */
export const noLoSubject = loSubject(new Set(LO_SUBJECTS));

export const TITLE_MESSAGE =
  'A native `title` is the system’s tooltip: slow, unstyled and not Lo’s. Name a control with `hint` on `Button`, or `Tooltip` around anything else (`cut` for a name cut short); a code view’s control takes `data-tip`. Words found nowhere else go on screen, not in a tooltip.';

/** Whether `node`, a JSX element's name, names a DOM element: `span`, not `Dialog` or `ui.Row`. */
function domElement(node: unknown): boolean {
  if (!isNode(node) || node.type !== 'JSXIdentifier') return false;
  const name: unknown = Reflect.get(node, 'name');
  return typeof name === 'string' && /^[a-z]/.test(name);
}

/** Whether `node` is the string `title`, as a literal. */
function titleLiteral(node: unknown): boolean {
  return isNode(node) && node.type === 'Literal' && Reflect.get(node, 'value') === 'title';
}

/**
 * The name of a key in an object literal: `title` in `{ title }`, `{ title: path }` or
 * `{ 'title': path }`.
 */
function keyName(node: AstNode): string | undefined {
  if (node.type !== 'Property') return undefined;
  const key: unknown = Reflect.get(node, 'key');
  if (!isNode(key)) return undefined;
  const name: unknown =
    key.type === 'Identifier' && !Reflect.get(node, 'computed')
      ? Reflect.get(key, 'name')
      : key.type === 'Literal'
        ? Reflect.get(key, 'value')
        : undefined;
  return typeof name === 'string' ? name : undefined;
}

/** The `title` key of `node`, when it's an object literal that has one. */
function titleIn(node: unknown): AstNode | undefined {
  const at = unwrapped(node);
  if (!isNode(at) || at.type !== 'ObjectExpression') return undefined;
  const properties: unknown = Reflect.get(at, 'properties');
  if (!Array.isArray(properties)) return undefined;
  return properties.find((each): each is AstNode => isNode(each) && keyName(each) === 'title');
}

/**
 * `lo/no-native-title` refuses a native tooltip: `title` on a DOM element in JSX
 * (`<span title={path}>`, or spread on it, `<span {...{ title }}>`), set as a property
 * (`ball.title = …`) or as an attribute (`setAttribute('title', …)`, or among the `attributes` of a
 * CodeMirror decoration), in the desktop app's source and its packages'. A component's own `title`,
 * a dialog's, a `Problem`'s or a toast's, is its text, and is left alone, and so is the window's,
 * `document.title`. A shared component that hands its props on to a DOM element leaves `title` out
 * of them, so none comes through one. A tooltip is Lo's own (`design/README.md`), and none is let
 * through.
 */
export const noNativeTitle = {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse a DOM element’s native `title`, the system’s tooltip.' },
  },
  create(context: Context) {
    const { filename } = context;
    const desktop = filename === undefined || DESKTOP.test(relative(ROOT, filename));
    const report = (node: AstNode): void => {
      if (desktop) context.report({ node, message: TITLE_MESSAGE });
    };
    return {
      JSXOpeningElement(node: AstNode): void {
        if (!domElement(Reflect.get(node, 'name'))) return;
        const attributes: unknown = Reflect.get(node, 'attributes');
        if (!Array.isArray(attributes)) return;
        for (const attribute of attributes) {
          if (!isNode(attribute)) continue;
          if (attribute.type === 'JSXSpreadAttribute') {
            const title = titleIn(Reflect.get(attribute, 'argument'));
            if (title) report(title);
            continue;
          }
          if (attribute.type !== 'JSXAttribute') continue;
          const name: unknown = Reflect.get(attribute, 'name');
          if (
            isNode(name) &&
            name.type === 'JSXIdentifier' &&
            Reflect.get(name, 'name') === 'title'
          ) {
            report(attribute);
          }
        }
      },
      AssignmentExpression(node: AstNode): void {
        const left: unknown = Reflect.get(node, 'left');
        if (memberName(left) !== 'title') return;
        const object: unknown = isNode(left) ? Reflect.get(left, 'object') : undefined;
        if (isNode(object) && object.type === 'Identifier') {
          if (Reflect.get(object, 'name') === 'document') return;
        }
        report(node);
      },
      // A CodeMirror decoration puts its `attributes` on the DOM element it draws.
      Property(node: AstNode): void {
        if (keyName(node) !== 'attributes') return;
        const title = titleIn(Reflect.get(node, 'value'));
        if (title) report(title);
      },
      CallExpression(node: AstNode): void {
        const name = memberName(Reflect.get(node, 'callee'));
        // The attribute's name: first, or after its namespace.
        const at = name === 'setAttribute' ? 0 : name === 'setAttributeNS' ? 1 : undefined;
        const args: unknown = Reflect.get(node, 'arguments');
        if (at !== undefined && Array.isArray(args) && titleLiteral(args[at])) report(node);
      },
    };
  },
};

export const ICON_MESSAGE =
  'An icon is `Icon` from `@lo/ui`, by its name in `icons.ts`, or `iconElement` in a code view’s own DOM. No component writes an `<svg>` of its own, and only `icons.ts` imports `lucide`.';

/**
 * The files that may write an `<svg>`, from the repository's root: `Icon`, which draws every icon,
 * and `iconElement`, which makes the same in a code view's own DOM, the mark and its animations,
 * and what draws an overview's figures, which aren't icons.
 */
const DRAWS_SVG: ReadonlySet<string> = new Set([
  'packages/desktop/ui/src/Icon.tsx',
  'packages/desktop/ui/src/iconElement.ts',
  'packages/desktop/ui/src/Mark.tsx',
  'packages/desktop/ui/src/LogoMotion.tsx',
  'packages/desktop/ui/src/figures/svg.ts',
]);

/** What makes an element from its name, first: the DOM's, React's and JSX's compiled form. */
const ELEMENT_MAKERS: ReadonlySet<string> = new Set(['createElement', 'jsx', 'jsxs', 'jsxDEV']);

/** The one file that imports `lucide`: the list of the icons Lo uses. */
const ICON_LIST = 'packages/desktop/ui/src/icons.ts';

/** `node`'s text, when it's a string written out whole: a literal, or a template with no `${}`. */
function wholeString(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Literal') {
    const value: unknown = Reflect.get(node, 'value');
    return typeof value === 'string' ? value : undefined;
  }
  if (node.type !== 'TemplateLiteral') return undefined;
  const expressions: unknown = Reflect.get(node, 'expressions');
  const texts = templateTexts(node);
  return Array.isArray(expressions) && expressions.length === 0 && texts.length === 1
    ? texts[0]
    : undefined;
}

/** The text between a template literal's `${}`, each part as it's read. */
function templateTexts(node: AstNode): string[] {
  const quasis: unknown = Reflect.get(node, 'quasis');
  if (!Array.isArray(quasis)) return [];
  return quasis.flatMap((quasi: unknown) => {
    const value: unknown = isNode(quasi) ? Reflect.get(quasi, 'value') : undefined;
    const text: unknown =
      typeof value === 'object' && value !== null ? Reflect.get(value, 'cooked') : undefined;
    return typeof text === 'string' ? [text] : [];
  });
}

/** Whether `node` is the string `svg`, as a literal or a template with nothing in it. */
function svgLiteral(node: unknown): boolean {
  return wholeString(node) === 'svg';
}

/** Whether `text` holds an svg to be drawn: its markup, or a data URL of one. */
function holdsSvg(text: string): boolean {
  return /<svg\b|data:image\/svg\+xml/i.test(text);
}

/** Whether `node`, a module's name, is an svg file, imported as its markup or its URL. */
function svgFile(node: unknown): boolean {
  if (!isNode(node) || node.type !== 'Literal') return false;
  const name: unknown = Reflect.get(node, 'value');
  return typeof name === 'string' && /\.svg(?:[?#]|$)/i.test(name);
}

/** Whether `node`, a module's name, is `lucide` or a file in it. */
function lucide(node: unknown): boolean {
  if (!isNode(node) || node.type !== 'Literal') return false;
  const name: unknown = Reflect.get(node, 'value');
  return typeof name === 'string' && (name === 'lucide' || name.startsWith('lucide/'));
}

/**
 * `lo/no-inline-icon` refuses an icon of a component's own, in the desktop app's source and its
 * packages', anywhere but `Icon`, the mark, its animations and figures ({@link DRAWS_SVG}): an
 * `<svg>` element in JSX; one made with `createElement('svg')`, `jsx('svg')` or
 * `createElementNS(…, 'svg')`, or with `createElementNS` and a name worked out as it runs; a string
 * holding `<svg` or an svg's data URL, as markup to set; and an imported `.svg` file. It refuses an
 * import of `lucide` anywhere but `icons.ts`. Lo's icons come from one set, drawn by `Icon`
 * (`design/README.md`, "Icons").
 */
export const noInlineIcon = {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse an icon that isn’t drawn by `Icon`, from Lo’s list of icons.' },
  },
  create(context: Context) {
    const path = context.filename === undefined ? undefined : relative(ROOT, context.filename);
    const desktop = path === undefined || DESKTOP.test(path);
    const drawsSvg = path !== undefined && DRAWS_SVG.has(path);
    const report = (node: AstNode): void => {
      if (desktop) context.report({ node, message: ICON_MESSAGE });
    };
    const svg = (node: AstNode): void => {
      if (!drawsSvg) report(node);
    };
    const source = (node: AstNode): void => {
      const from: unknown = Reflect.get(node, 'source');
      if (path !== ICON_LIST && lucide(from)) report(node);
      else if (svgFile(from)) svg(node);
    };
    return {
      JSXOpeningElement(node: AstNode): void {
        const name: unknown = Reflect.get(node, 'name');
        if (isNode(name) && name.type === 'JSXIdentifier' && Reflect.get(name, 'name') === 'svg') {
          svg(node);
        }
      },
      CallExpression(node: AstNode): void {
        const name = calleeName(Reflect.get(node, 'callee'));
        const args: unknown = Reflect.get(node, 'arguments');
        if (!Array.isArray(args)) return;
        // The element's name: first, or after its namespace. In a namespace, which only an svg's
        // shapes take here, a name worked out as it runs could be any of them.
        if (name === 'createElementNS') {
          if (
            args[1] !== undefined &&
            (svgLiteral(args[1]) || wholeString(args[1]) === undefined)
          ) {
            svg(node);
          }
        } else if (name !== undefined && ELEMENT_MAKERS.has(name) && svgLiteral(args[0])) {
          svg(node);
        }
      },
      Literal(node: AstNode): void {
        const value: unknown = Reflect.get(node, 'value');
        if (typeof value === 'string' && holdsSvg(value)) svg(node);
      },
      TemplateLiteral(node: AstNode): void {
        if (templateTexts(node).some(holdsSvg)) svg(node);
      },
      ImportDeclaration: source,
      ImportExpression: source,
      ExportAllDeclaration: source,
      ExportNamedDeclaration: source,
    };
  },
};

export default {
  meta: { name: 'lo' },
  rules: {
    'no-returned-never': noReturnedNever,
    'no-scroll-into-view': noScrollIntoView,
    'no-lo-subject': noLoSubject,
    'no-native-title': noNativeTitle,
    'no-straight-apostrophe': noStraightApostrophe,
    'no-inline-icon': noInlineIcon,
  },
};
