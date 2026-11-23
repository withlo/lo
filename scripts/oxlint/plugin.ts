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

/**
 * `lo/no-lo-subject` refuses a string the reader may see that starts with "Lo " and a word in lower
 * case: a string or template literal, or JSX text. Lo isn't the subject of what it says
 * (`design/writing.md`). A version, "Lo 0.9.0", and a name, "Lo Dev", are left alone, and so is a
 * log call's message (`console.*`, and anything called `log`, `warn`, `debug`, `trace` or `info`),
 * which only a developer reads. An error's message isn't left alone: `describe` puts one on screen.
 * It checks the desktop app's strings, its source's and its packages', and lets through those
 * `known` lists, by {@link subjectEntry}.
 */
export function loSubject(known: ReadonlySet<string>) {
  return {
    meta: {
      type: 'suggestion',
      docs: { description: 'Refuse a string the reader may see that makes Lo its subject.' },
    },
    create(context: Context) {
      /** The spans of log calls' arguments, which only a developer reads. */
      const unread: [number, number][] = [];
      const { filename, sourceCode } = context;
      const desktop = filename === undefined || DESKTOP.test(relative(ROOT, filename));
      const check = (node: AstNode, text: unknown): void => {
        if (!desktop || typeof text !== 'string' || !LO_SUBJECT.test(text)) return;
        const [start, end] = spanOf(node);
        if (unread.some(([from, to]) => start >= from && end <= to)) return;
        if (filename !== undefined && sourceCode !== undefined) {
          if (known.has(subjectEntry(filename, sourceCode.getText(node)))) return;
        }
        context.report({ node, message: SUBJECT_MESSAGE });
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
          check(node, Reflect.get(node, 'value'));
        },
        TemplateLiteral(node: AstNode): void {
          const quasis: unknown = Reflect.get(node, 'quasis');
          const first: unknown = Array.isArray(quasis) ? quasis[0] : undefined;
          const value: unknown = isNode(first) ? Reflect.get(first, 'value') : undefined;
          check(
            node,
            typeof value === 'object' && value !== null ? Reflect.get(value, 'cooked') : undefined,
          );
        },
        JSXText(node: AstNode): void {
          const value: unknown = Reflect.get(node, 'value');
          check(node, typeof value === 'string' ? value.trimStart() : undefined);
        },
      };
    },
  };
}

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

export default {
  meta: { name: 'lo' },
  rules: {
    'no-returned-never': noReturnedNever,
    'no-scroll-into-view': noScrollIntoView,
    'no-lo-subject': noLoSubject,
    'no-native-title': noNativeTitle,
  },
};
