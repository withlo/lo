# Sending pull request links to Lo

A link router is an app that decides which app opens each link you click, so a pull request link
from Slack, Mail or a terminal can open in Lo while your browser stays the default. Lo registers
itself as an app that can open web links, without becoming your default browser, so a router can
offer it. [Finicky](https://github.com/johnste/finicky), [Velja](https://sindresorhus.com/velja) and
[Choosy](https://choosy.app) are the ones Lo has rules for.

"Send PR links to Lo" on the welcome screen opens a dialog with the rules below, each with a Copy
button.

## What a rule matches

A rule sends Lo a pull request's page and its Files, Commits and Checks pages:
`https://github.com/<owner>/<repo>/pull/<number>` and what follows it, such as a file's anchor or a
query. It leaves every other GitHub link to your browser: issues, repositories, files, gists, and a
sign-in page that happens to mention a pull request.

Lo opens a link to a pull request in a tab. A link it doesn't show, such as an issue, it hands to
your browser.

## Links Lo opens itself

Each rule skips links that Lo itself opened. Lo opens some GitHub pages in the browser: any link it
doesn't show, and "Open on GitHub", which is a pull request's own page. A link router is your
system's browser, so that link reaches the router first. A rule that sent it back to Lo would send
it round in a circle, since Lo would only hand it to the browser again, and the page would never
open. Lo hands a link on once, and says in a note if it comes straight back.

Each router tells Lo's own links apart by the app that opened them. Lo's bundle ID is
`com.scornz.lo`.

## Finicky

These rules are for Finicky 4, which reads `~/.finicky.js` and exports its configuration with
`export default`. Add this handler to its `handlers`. It matches only when the app that opened the
link isn't Lo (`opener.bundleId`), and opens Lo by its bundle ID:

```js
{
  match: (url, { opener }) =>
    opener?.bundleId !== "com.scornz.lo" &&
    url.host === "github.com" &&
    /^\/[^/]+\/[^/]+\/pull\/\d+(\/|$)/.test(url.pathname),
  browser: "com.scornz.lo",
},
```

## Velja

This setup hasn't been tried in Velja: it follows Velja's documentation, which doesn't say how its
rules are ordered or what syntax its URL patterns take.

In Velja's settings, open Rules. Velja's matchers include "Source Apps", the app a link was clicked
in, and "URL Matchers". Add two rules:

1. A rule with a Source Apps matcher set to Lo, that opens in your browser, so the links Lo opens go
   to the browser.
2. A rule that opens in Lo, with a URL Matchers matcher with this pattern:

```text
^(?:https://)?github\.com/[^/?#]+/[^/?#]+/pull/\d+(?:[/?#]|$)
```

If Lo's own GitHub links come back to Lo, the source-app rule must sit above the Lo rule.

## Choosy

In Choosy's settings, open Rules and add a rule that opens in Lo when all of these hold:

- The URL matches this regular expression. Choosy matches the whole link, so the expression is
  anchored at both ends, and allows anything after the pull request's number:

  ```text
  ^https://github\.com/[^/?#]+/[^/?#]+/pull/\d+(?:[/?#].*)?$
  ```

- The Source application is not Lo.

## From a terminal

`lo <link>` opens a pull request from a terminal. Install it from the welcome screen, from Settings
or from Lo's menu ("Install command-line tool"). `lo://github.com/<owner>/<repo>/pull/<number>`
links open a pull request too.
