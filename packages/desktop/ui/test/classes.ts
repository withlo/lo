// Which of a rendered component's utilities Lo's stylesheet has no rule for. Its theme holds only
// Lo's tokens, so a utility made of a number beside a step, such as `p-10`, makes no CSS and drops
// its spacing without a word.

import { buildCss, hasRule } from '../scripts/stylesheet.ts';

/**
 * The classes under `root`, and `extra` ones that only a state adds, that Tailwind makes no rule
 * for. Lo's own `lo-` classes and the `group/` markers aren't utilities, so they aren't asked.
 */
export async function missingRules(
  root: Element,
  extra: readonly string[] = [],
): Promise<string[]> {
  const names = new Set<string>(extra);
  for (const element of root.querySelectorAll('[class]')) {
    for (const name of element.classList) names.add(name);
  }
  const classes = [...names].filter(
    (name) => !name.startsWith('lo-') && !name.startsWith('group/'),
  );
  const css = await buildCss(classes);
  return classes.filter((name) => !hasRule(css, name));
}
