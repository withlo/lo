/**
 * Lo's own lint rules, which oxlint loads from `.oxlintrc.json` as the `lo` plugin.
 *
 * `lo/no-returned-never` refuses handing on `value satisfies never`: returning it, an arrow
 * function whose body is it, assigning it, declaring a variable with it, or yielding it. In a
 * switch's `default`, the check fails to compile when a member of the union isn't handled, but a
 * value outside the union still gets there at runtime, and handing it on passes it off as whatever
 * the function returns, the variable holds or the generator yields. Check the value with
 * `value satisfies never;`, then throw an error naming it, or, for a value that can come from
 * outside Lo, such as GitHub's answer or what Lo saved, give a safe answer.
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
    docs: {
      description:
        'Disallow returning, assigning or yielding `value satisfies never`, which hands the value on.',
    },
  },
  create(context: Context) {
    /** Reports `node`'s `field` when it's a value checked as never. */
    const check = (node: AstNode, field: string): void => {
      const found = neverCheck(Reflect.get(node, field));
      if (found) context.report({ node: found, message: MESSAGE });
    };
    return {
      ReturnStatement(node: AstNode): void {
        check(node, 'argument');
      },
      ArrowFunctionExpression(node: AstNode): void {
        check(node, 'body');
      },
      AssignmentExpression(node: AstNode): void {
        check(node, 'right');
      },
      VariableDeclarator(node: AstNode): void {
        check(node, 'init');
      },
      YieldExpression(node: AstNode): void {
        check(node, 'argument');
      },
    };
  },
};

export default {
  meta: { name: 'lo' },
  rules: { 'no-returned-never': noReturnedNever },
};
