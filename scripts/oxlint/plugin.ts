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
 * `lo/no-lo-subject` flags a string the reader may see that starts with "Lo ": see
 * {@link noLoSubject}.
 */

/** A syntax tree node, as oxlint hands one to a rule. */
interface AstNode {
  readonly type: string;
}

/** What a rule reports through. */
interface Context {
  report(diagnostic: { node: AstNode; message: string }): void;
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

/** What logs a message and what makes an error no one reads but a developer, by name. */
const UNREAD_CALLS = new Set(['log', 'warn', 'debug', 'trace', 'info']);
const UNREAD_ERRORS = new Set(['Error', 'TypeError', 'RangeError', 'DOMException']);

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
 * `lo/no-lo-subject` flags a string the reader may see that starts with "Lo " and a word in lower
 * case: a string or template literal, or JSX text. Lo isn't the subject of what it says
 * (`design/writing.md`). A version, "Lo 0.9.0", and a name, "Lo Dev", are left alone, and so is
 * what only a developer reads: a log call's message
 * (`console.*`, and anything called `log`, `warn`, `debug`, `trace` or `info`) and a plain
 * `Error`'s. Strings that remain are counted against a ceiling in its test, which only goes down,
 * until there are none and it's an error in `.oxlintrc.json`.
 */
export const noLoSubject = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Flag a string the reader may see that makes Lo its subject.' },
  },
  create(context: Context) {
    /** The spans of log calls' and plain errors' arguments, which only a developer reads. */
    const unread: [number, number][] = [];
    const skip = (node: AstNode): void => {
      const args: unknown = Reflect.get(node, 'arguments');
      if (!Array.isArray(args)) return;
      for (const arg of args) if (isNode(arg)) unread.push(spanOf(arg));
    };
    const check = (node: AstNode, text: unknown): void => {
      if (typeof text !== 'string' || !LO_SUBJECT.test(text)) return;
      const [start, end] = spanOf(node);
      if (unread.some(([from, to]) => start >= from && end <= to)) return;
      context.report({ node, message: SUBJECT_MESSAGE });
    };
    return {
      CallExpression(node: AstNode): void {
        const callee: unknown = Reflect.get(node, 'callee');
        const name = calleeName(callee);
        if (onConsole(callee) || (name !== undefined && UNREAD_CALLS.has(name))) skip(node);
      },
      NewExpression(node: AstNode): void {
        const name = calleeName(Reflect.get(node, 'callee'));
        if (name !== undefined && UNREAD_ERRORS.has(name)) skip(node);
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

export default {
  meta: { name: 'lo' },
  rules: {
    'no-returned-never': noReturnedNever,
    'no-scroll-into-view': noScrollIntoView,
    'no-lo-subject': noLoSubject,
  },
};
