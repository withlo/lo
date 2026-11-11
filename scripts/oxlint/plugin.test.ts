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
  `;
  expect(reported(source)).toEqual([]);
});
