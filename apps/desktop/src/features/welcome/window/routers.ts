// Ready-made rules for the link routers that send a link to the app that should open it, so a
// pull request link clicked anywhere opens in Lo while the browser stays the default. Each rule
// matches a pull request's page and its Files, Commits and Checks pages and nothing else, and
// skips links that Lo itself opened.
//
// Lo opens a link in the browser when it doesn't show it, and for "Open on GitHub", which is a
// pull request's own page. With a router as the system's browser, that link reaches the router
// first, and a rule that sent it back to Lo would send it round in a circle: the page would never
// open. So each rule leaves Lo's own links to the browser.

/** Where the rules are written out, with the steps for each router. */
export const DOCS = 'https://github.com/withlo/lo/blob/main/docs/link-routers.md';

/** Lo's bundle ID, which a router names Lo by and tells Lo's own links by: `appId` in the build. */
export const BUNDLE_ID = 'com.scornz.lo';

/** An owner's or a repository's name in a link: anything but `/`, `?` and `#`. */
const NAME = String.raw`[^/?#]+`;

/** A pull request's number. */
const NUMBER = String.raw`\d+`;

export interface Router {
  /** The router's name, as its own app writes it. */
  readonly name: string;
  /** What to do with the rule, in a few sentences, with how it skips Lo's own links. */
  readonly steps: string;
  /** The rule to copy. */
  readonly rule: string;
}

/** The routers Lo has rules for, in the order the dialog lists them. */
export const routers: readonly Router[] = [
  {
    name: 'Finicky',
    steps:
      'Add this handler to the handlers in ~/.finicky.js. It is for Finicky 4. It skips links that Lo opened, which it tells by Lo’s bundle ID.',
    rule: String.raw`{
  match: (url, { opener }) =>
    opener?.bundleId !== "${BUNDLE_ID}" &&
    url.host === "github.com" &&
    /^\/[^/]+\/[^/]+\/pull\/\d+(\/|$)/.test(url.pathname),
  browser: "${BUNDLE_ID}",
},`,
  },
  {
    name: 'Velja',
    steps:
      'In Velja’s settings, open Rules. Add a rule with a Source Apps matcher set to Lo that opens in your browser, so links Lo opens go to the browser, and keep it above the next one. Add a rule that opens in Lo, with a URL Matchers matcher with this pattern.',
    rule: String.raw`^(?:https://)?github\.com/${NAME}/${NAME}/pull/${NUMBER}(?:[/?#]|$)`,
  },
  {
    name: 'Choosy',
    steps:
      'In Choosy’s settings, open Rules and add a rule that opens in Lo when all of these hold: the URL matches this regular expression, and the Source application is not Lo.',
    rule: String.raw`https://github\.com/${NAME}/${NAME}/pull/${NUMBER}(?:[/?#].*)?`,
  },
];
