// Lints the design system's plain CSS. Colors come from the tokens, as `var(--lo-*)`: tokens.json
// is the only place a color value is written, and the generated css/tokens.css the only stylesheet
// that holds one.

/** Properties that take nothing but a color. */
const colorProperties =
  /^(?:color|background-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|outline-color|text-decoration-color|caret-color|accent-color|column-rule-color|fill|stroke|stop-color|flood-color|lighting-color)$/;

/** A token, or a keyword that isn't a color of its own. */
const tokenOrKeyword =
  /^(?:var\(--(?:lo|fig)-[a-z0-9-]+\)|transparent|currentcolor|inherit|initial|unset|revert|none)$/i;

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-recommended'],
  ignoreFiles: ['css/tokens.css'],
  rules: {
    // Its order checks compare selectors from separate components, which style different elements.
    'no-descending-specificity': null,
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'],
      { message: (name) => `Use a token (var(--lo-*)) instead of ${name}().` },
    ],
    'declaration-property-value-allowed-list': [
      { [colorProperties.source]: [tokenOrKeyword] },
      { message: (property) => `${property} takes a token: var(--lo-*).` },
    ],
  },
};
