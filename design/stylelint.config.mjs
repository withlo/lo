// Lints every stylesheet: the design system's plain CSS, and the app's, Tailwind's sources among
// them. Colors come from the tokens, as `var(--lo-*)`: tokens.json is the only place a color value
// is written, and the generated css/tokens.css the only stylesheet that holds one. A selector
// Chromium can't parse, as a `:has()` inside another, fails here (`selector-no-invalid`), since
// Chromium drops the whole rule for it without a word.

/** Properties that take nothing but a color. */
const colorProperties =
  /^(?:color|background-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|outline-color|text-decoration-color|caret-color|accent-color|column-rule-color|fill|stroke|stop-color|flood-color|lighting-color)$/;

/** A token, or a keyword that isn't a color of its own. */
const tokenOrKeyword =
  /^(?:var\(--(?:lo|fig)-[a-z0-9-]+\)|transparent|currentcolor|inherit|initial|unset|revert|none)$/i;

/** Tailwind's own at-rules, in the stylesheets Tailwind builds. */
const TAILWIND_AT_RULES = ['theme', 'utility', 'source', 'custom-variant', 'variant', 'apply'];

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-recommended'],
  ignoreFiles: ['css/tokens.css'],
  rules: {
    // Its order checks compare selectors from separate components, which style different elements.
    'no-descending-specificity': null,
    'at-rule-no-unknown': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
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
  overrides: [
    {
      // Tailwind's sources: a utility's rules are nested under the class it makes, `&` among them,
      // and the theme declares its variables at the top.
      files: ['**/styles.css', '**/theme.css'],
      rules: {
        'nesting-selector-no-missing-scoping-root': null,
        'no-invalid-position-declaration': null,
      },
    },
  ],
};
