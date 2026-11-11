/**
 * Lo's own lint rules, which oxlint loads from `.oxlintrc.json` as the `lo` plugin.
 *
 * `lo/no-returned-never` refuses `return value satisfies never`, and an arrow function whose body
 * is `value satisfies never`. In a switch's `default`, the check fails to compile when a member of
 * the union isn't handled, but a value outside the union still gets there at runtime, and the
 * `return` hands it back as the answer, typed as whatever the function returns. Check the value
 * with `value satisfies never;`, then throw an error naming it, or, for a value that can come from
 * outside Lo, such as GitHub's answer or what Lo saved, return a safe answer.
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
  'This returns a value outside its union as the answer. Check it with `value satisfies never;`, then throw an error naming it, or return a safe answer for a value from outside Lo.';

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  );
}

/** `node` without the parentheses around it. */
function unwrapped(node: unknown): unknown {
  let at = node;
  while (isNode(at) && at.type === 'ParenthesizedExpression') at = Reflect.get(at, 'expression');
  return at;
}

/** `node`, when it's `value satisfies never`. */
function neverCheck(node: unknown): AstNode | undefined {
  const at = unwrapped(node);
  if (!isNode(at) || at.type !== 'TSSatisfiesExpression') return undefined;
  const type: unknown = Reflect.get(at, 'typeAnnotation');
  return isNode(type) && type.type === 'TSNeverKeyword' ? at : undefined;
}

export const noReturnedNever = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow returning `value satisfies never`.' },
  },
  create(context: Context) {
    const check = (returned: unknown): void => {
      const found = neverCheck(returned);
      if (found) context.report({ node: found, message: MESSAGE });
    };
    return {
      ReturnStatement(node: AstNode): void {
        check(Reflect.get(node, 'argument'));
      },
      ArrowFunctionExpression(node: AstNode): void {
        check(Reflect.get(node, 'body'));
      },
    };
  },
};

export default {
  meta: { name: 'lo' },
  rules: { 'no-returned-never': noReturnedNever },
};
