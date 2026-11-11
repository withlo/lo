import { fromParse5 } from 'hast-util-from-parse5';
import { sanitize } from 'hast-util-sanitize';
import { expect, test } from 'vitest';

import { SCHEMA } from './github.ts';
import { parseHtml, prepare, textOf, withoutComments } from './html.ts';

const HIDDEN = `<script>a</script><style>b</style><template>c</template><svg><text>d</text></svg><math><mi>e</mi></math><iframe>f</iframe><noscript>g</noscript><object>h</object><title>i</title>`;

test('what GitHub never shows is gone before anything reads the HTML', () => {
  const fragment = parseHtml(`<p>shown</p>${HIDDEN}<!-- j -->`, 1_000)!;
  expect(prepare(fragment, 64)).toBe(false);
  expect(fragment.childNodes.map((node) => node.nodeName)).toEqual(['p']);
  expect(textOf(fragment)).toBe('\nshown\n');
});

test('and the sanitizer drops it again, whatever reaches it', () => {
  const fragment = parseHtml(`<p>shown</p>${HIDDEN}`, 1_000);
  const root = sanitize(fromParse5(fragment!), SCHEMA);
  expect(JSON.stringify(root)).not.toMatch(/"value":"[a-i]"/);
});

test("a form's text still shows", () => {
  const fragment = parseHtml(
    '<textarea>typed</textarea><select><option>chosen</option></select>',
    100,
  )!;
  prepare(fragment, 64);
  expect(textOf(fragment)).toBe('typedchosen');
});

test('a parse stops at its cap on elements', () => {
  expect(parseHtml('<b>'.repeat(20), 12)).toBe(undefined);
  expect(parseHtml('<b>'.repeat(9), 12)).toBeDefined();
});

test('HTML nested past the depth is its text', () => {
  const fragment = parseHtml(
    `${'<div>'.repeat(100)}deep${'</div>'.repeat(100)}<p>after</p>`,
    1_000,
  )!;
  expect(prepare(fragment, 10)).toBe(true);
  // The first child, down the tree, as deep as it goes.
  let depth = 0;
  for (let node = fragment.childNodes[0]; node && 'childNodes' in node; node = node.childNodes[0]) {
    depth += 1;
  }
  expect(depth).toBeLessThanOrEqual(10);
  expect(textOf(fragment).replaceAll('\n', '')).toBe('deepafter');
});

test('comments are found as an HTML parser finds them', () => {
  expect(withoutComments('a<!-- b -->c', 100)).toBe('ac');
  expect(withoutComments('<p title="<!--">a</p><p title="-->">b</p>', 100)).toBe(
    '<p title="<!--">a</p><p title="-->">b</p>',
  );
  expect(withoutComments('a<!-- open', 100)).toBe('a');
  expect(withoutComments('a<?bogus?>b</ c>d', 100)).toBe('abd');
  // Past the cap on elements, it's left as it is.
  expect(withoutComments(`${'<b>'.repeat(200)}<!-- x -->`, 100)).toBe(
    `${'<b>'.repeat(200)}<!-- x -->`,
  );
});
