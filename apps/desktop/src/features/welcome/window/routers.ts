// Ready-made rules for the link routers that send a link to the app that should open it, so a
// pull request link clicked anywhere opens in Lo while the browser stays the default. Each rule
// matches a pull request's page and its Files, Commits and Checks pages, and nothing else: Lo
// hands any other link back to the browser, and a router that sent it every link would send it
// round in a circle.

/** Where the rules are written out, with the steps for each router. */
export const DOCS = 'https://github.com/withlo/lo/blob/main/docs/link-routers.md';

export interface Router {
  /** The router's name, as its own app writes it. */
  readonly name: string;
  /** What to do with the rule, in a sentence or two. */
  readonly steps: string;
  /** The rule to copy. */
  readonly rule: string;
}

/** The routers Lo has rules for, in the order the dialog lists them. */
export const routers: readonly Router[] = [
  {
    name: 'Finicky',
    steps: 'Add this handler to the handlers in ~/.finicky.js.',
    rule: String.raw`{
  match: (url) =>
    url.host === "github.com" &&
    /^\/[^/]+\/[^/]+\/pull\/\d+(\/|$)/.test(url.pathname),
  browser: "Lo",
},`,
  },
  {
    name: 'Velja',
    steps:
      'In Velja’s settings, open Rules and add a rule. Give it a URL Matchers matcher with this pattern, and set the rule to open in Lo.',
    rule: 'github.com/*/*/pull/*',
  },
  {
    name: 'Choosy',
    steps:
      'In Choosy’s settings, open Rules and add a URL rule that matches this regular expression, and set it to open in Lo.',
    rule: String.raw`https://github\.com/.+/.+/pull/\d+.*`,
  },
];
