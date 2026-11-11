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
`https://github.com/<owner>/<repo>/pull/<number>` and what follows it. It leaves every other GitHub
link to your browser: issues, repositories, files, gists.

Lo opens a link to a pull request in a tab. A link it doesn't show, such as an issue, it hands to
your browser. If a router sends Lo links that aren't pull requests, they would go back and forth, so
Lo hands the same link on once, and says so in a note if it comes straight back. Keep a rule to pull
requests.

## Finicky

Add this handler to the `handlers` in `~/.finicky.js`:

```js
{
  match: (url) =>
    url.host === "github.com" &&
    /^\/[^/]+\/[^/]+\/pull\/\d+(\/|$)/.test(url.pathname),
  browser: "Lo",
},
```

## Velja

In Velja's settings, open Rules and add a rule. Give it a URL Matchers matcher with this pattern,
and set the rule to open in Lo:

```text
github.com/*/*/pull/*
```

The pattern also matches GitHub's page for starting a new pull request (`…/pull/new/<branch>`),
which Lo hands back to your browser.

## Choosy

In Choosy's settings, open Rules and add a URL rule that matches this regular expression, and set it
to open in Lo. Choosy matches the whole link, so the expression ends with `.*`:

```text
https://github\.com/.+/.+/pull/\d+.*
```

## From a terminal

`lo <link>` opens a pull request from a terminal. Install it from the welcome screen, from Settings
or from Lo's menu ("Install command-line tool"). `lo://github.com/<owner>/<repo>/pull/<number>`
links open a pull request too.
