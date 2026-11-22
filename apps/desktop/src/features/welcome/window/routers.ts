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
  /** The app's name, as it writes it, with the version the rule is for where that matters. */
  readonly name: string;
  /** What to do with the rule, one step to a line. Between backticks is code. */
  readonly steps: readonly string[];
  /** The rule to copy. */
  readonly rule: string;
}

/** The apps Lo has rules for, in the order the dialog lists them. */
export const routers: readonly Router[] = [
  {
    name: 'Finicky 4',
    steps: ['Add this rule to `handlers` in `~/.finicky.js`.'],
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
    steps: [
      'Open Velja › Settings › Rules.',
      'Add a rule that opens your browser, with Source Apps set to Lo.',
      'Below it, add a rule that opens Lo, with this pattern in URL Matchers.',
    ],
    rule: String.raw`^(?:https://)?github\.com/${NAME}/${NAME}/pull/${NUMBER}(?:[/?#]|$)`,
  },
  {
    name: 'Choosy',
    steps: [
      'Open Choosy › Settings › Rules.',
      'Add a rule that opens Lo when all of its conditions match.',
      'Add the condition Source application is not Lo.',
      'Add the condition URL matches this regular expression.',
    ],
    rule: String.raw`^https://github\.com/${NAME}/${NAME}/pull/${NUMBER}(?:[/?#].*)?$`,
  },
];
