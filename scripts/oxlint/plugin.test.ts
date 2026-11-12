import { parseSync, Visitor } from 'oxc-parser';
import { expect, test } from 'vitest';

import plugin, { MESSAGE } from './plugin.ts';

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
