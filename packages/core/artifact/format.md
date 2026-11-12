# The overview format

An overview explains a pull request in Lo. Its writer, usually a coding agent, writes `artifact.md`
and any figures in `figures/`, commits them, and pushes the commit to `refs/lo/pr/<number>` in the
pull request's repository. Lo reads them from there and shows the overview beside the diff.

`artifact.md` is GitHub's Markdown with a header, required sections and a few blocks of its own. Lo
shows code from the repository itself, so an overview names a file and its lines and never copies
code. This is format 1.

An overview that breaks a rule here is invalid: Lo shows the pull request's diff instead, with a
report of what's wrong. A few rules are about what's outside `artifact.md`, and breaking one leaves
out only what it's about: a block whose code isn't there shows a note in its place, and a file the
commit shouldn't hold is never read. The checker reports every rule broken before you push. Warnings
don't stop an overview from showing.

## An example

```text
---
format: 1
pr: 4797
commit: 3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e
---

## tl;dr

Requests over a tenant's quota now wait in a [bucket](term:bucket) instead of failing at once, so
short bursts no longer end in errors. The quota itself is unchanged.

## How it works

The limiter takes a token from the tenant's bucket before it forwards a request:

:::code src/limiter.ts#L46-L58
:::

:::figure figures/flow.svg
A request waits for a token in its tenant's bucket, then goes on to the API.

- [bucket](term:bucket)
- [limiter](code:src/limiter.ts#L12-L40)
:::

:::walkthrough One request, start to finish
:::step src/limiter.ts#L12-L20
The limiter finds the tenant's bucket, and makes one on the tenant's first request.
:::
:::step src/limiter.ts#L46-L58
With no token free, the request waits, for up to [the timeout](code:src/config.ts#L8).
:::
:::step src/limiter.ts#L60-L64
A token coming back wakes the request that has waited longest.
:::
:::

## Where to look

:::tabs
:::tab Before
A burst over the quota failed at once.
:::
:::tab After
A burst over the quota waits, and fails only after the timeout.
:::
:::

:::fold Why not a queue per request
A queue per request would keep a timer for each one. The bucket keeps one timer per tenant.
:::

## How it was checked

The new burst tests in [limiter.test.ts](code:src/limiter.test.ts) pass, as do the rest.

## Glossary

- **Bucket**: the tokens a tenant has to spend. Each request takes one, and they come back at the
  tenant's quota rate.
```

## The files

- **`artifact.md`:** the overview's text, in UTF-8, up to 256 KiB: a file, never a link. A
  byte-order mark at its start is ignored, and lines may end in `\n` or `\r\n`.
- **`figures/`:** the overview's figures, each a file directly in the folder.

Nothing else may be in the commit: no other file, folder, link or submodule. Names match exactly, so
`Artifact.md` isn't `artifact.md`.

## The header

`artifact.md` starts with its header: a line of `---`, three lines of `key: value` in any order, and
another line of `---`.

```text
---
format: 1
pr: 4797
commit: 3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e
---

## tl;dr

The smallest overview: a header and a tl;dr.
```

- **`format`** is the format the overview is written in: `1`.
- **`pr`** is the pull request's number. An overview found on another pull request's ref is invalid.
- **`commit`** is the full id of the commit the overview describes, as `git rev-parse` prints it: 40
  lowercase hexadecimal digits, or 64 in a SHA-256 repository. Lo shows code at this commit.

Each key appears once, and nothing else may appear: no blank lines, comments or other keys. It isn't
YAML, so quotes, anchors and tags aren't read either. Numbers are plain: no sign, no leading zero,
no decimal point.

## Sections

The overview is a series of sections, each starting with a `##` heading, in the order you choose.

- **`## tl;dr`** comes first, holding text: what the pull request does and why.
- **`## Glossary`**, if there is one, holds only a list of terms (see [Terms](#terms)).
- **Any other section** holds whatever you like. With no other instructions, write "How it works",
  "Where to look" and "How it was checked".

Nothing comes before the tl;dr, and the tl;dr and the glossary each appear once. There's no `#`
heading anywhere, since the pull request's title is the overview's. A `##` heading never sits inside
a block: use `###` there.

## Blocks

A block starts with a line of three or more colons followed by its kind and, for most kinds, an
argument. A line of three or more colons with nothing after them closes the innermost block still
open, so blocks inside blocks need nothing special:

```text
:::tabs
:::tab Before
A burst over the quota failed at once.
:::
:::tab After
A burst over the quota waits.
:::
:::
```

- **An argument** is one line of plain text, at most 1,024 bytes: a title, or a target. A target
  with spaces in its path may go inside `<` and `>`.
- **A block closes where it opens:** in the same list item or quote, or at the top level.
- **Blocks nest at most 4 deep.**
- **Any other kind is invalid,** as is a block left open or a closing line with no block open.

### Code

`:::code` shows lines of the repository's code at the header's commit. Its argument is a target with
lines, at most 200 of them, and the block is empty: Lo fills it in.

```text
:::code src/limiter.ts#L46-L58
:::
```

Lo shows the lines as the pull request changed them, with their review threads. A plain fenced code
block is shown as an illustration, never as the repository's code.

### Figures

`:::figure` shows a file from `figures/`. Its argument is the file's path, and the block holds the
figure's caption: a sentence or two saying what it shows. A list at the end of the block, each item
one link, makes parts of the figure links:

```text
:::figure figures/flow.svg
A request waits for a token in its tenant's bucket, then goes on to the API.

- [bucket](code:src/bucket.ts#L1-L30)
- [limiter](code:src/limiter.ts#L12-L40)
:::
```

The link's text is the id of an element in the figure, and the link goes to code, a term or a
section. An id starts with a letter or `_`, followed by letters, digits, `_`, `.` or `-`, up to 64
in all, and is linked once. Only an SVG has parts: an image's figure has no such list.

### Walkthroughs

`:::walkthrough` holds 3 to 50 steps, and nothing else. Its argument is its title. Each `:::step`
names the lines it's about, at most 200, and holds the text for them, without blocks. Lo shows the
steps beside a code view that follows them.

```text
:::walkthrough One request, start to finish
:::step src/limiter.ts#L12-L20
The limiter finds the tenant's bucket, and makes one on the tenant's first request.
:::
:::step src/limiter.ts#L46-L58
With no token free, the request waits.
:::
:::step src/limiter.ts#L60-L64
A token coming back wakes the request that has waited longest.
:::
:::
```

With fewer than 3 steps, write prose instead.

### Tabs

`:::tabs` holds 2 to 12 `:::tab` blocks, and nothing else. It takes no argument, and each tab's
argument is its title. Use tabs for parallel views of one thing, such as before and after.

### Folds

`:::fold` holds material most readers can skip. Its argument is its title, and it shows closed.

```text
:::fold Why not a queue per request
A queue per request would keep a timer for each one.
:::
```

Never put the main point of a section in a tab or a fold.

## Targets

Wherever an overview points, it uses one form:

| Points at        | Written                      | Example                  |
| ---------------- | ---------------------------- | ------------------------ |
| Lines of code    | a path, `#`, then lines      | `src/limiter.ts#L46-L58` |
| One line of code | a path, `#`, then the line   | `src/config.ts#L8`       |
| A whole file     | a path, from a link only     | `src/limiter.test.ts`    |
| A term           | its name, from a link only   | `bucket`                 |
| A heading        | `#` and the heading's anchor | `#how-it-works`          |

Blocks take targets as their argument. Links take them with a scheme, through Markdown's link
syntax: `[the limiter](code:src/limiter.ts#L12-L40)`, `[buckets](term:bucket)`,
`[as above](#how-it-works)`. A path with spaces goes inside `<` and `>`:
`[it](<code:docs/read me.md>)`.

- **Paths** are from the repository's root, without a leading `/`, and exactly as the repository
  writes them: the same case, the same Unicode form, no `%` escapes. No part is empty, `.`, `..` or
  `.git`, and none holds `\`, a control character or an invisible one, such as a zero-width space or
  a right-to-left mark. The last `#` starts the lines, so a file whose path holds a `#` can be named
  only with its lines: a link can't name it whole.
- **Lines** count from 1: `L12` is one line, `L12-L44` the lines from 12 to 44. A code block and a
  step show at most 200 lines; for more, link the file.
- **The code** is the repository's at the header's commit, so a target is any file there: changed by
  the pull request or not. It's a file, not a link, folder or submodule, and when the target names
  lines, the file is text and has them. Lo shows a note in place of code that isn't there.
- **A heading's anchor** is GitHub's: its text in lower case, punctuation removed, spaces as `-`,
  and `-1`, `-2` and on for repeats.
- **At most 500 targets** in all: code, terms and sections, from blocks, steps, parts and links.

A link to a web page works as on GitHub. A link to anything else, such as a relative path, shows as
plain text, with a warning. So does a link to a web page or a section once the links before it to
web pages and sections have taken 131,072 characters of addresses in all, counting every link, even
one to the same place.

## Terms

A term is a word the overview defines, so a reader can see its definition wherever it's used. Mark
each use with a `term:` link, and define each term once in the glossary:

```text
## How it works

Each tenant gets a [bucket](term:bucket), and its [buckets](term:bucket) refill over time.

## Glossary

- **Bucket**: the tokens a tenant has to spend.
```

- **Matching** ignores case and runs of spaces: `[maps](<term:Hash  Map>)` names `**hash map**`. A
  term holds no control or invisible character.
- **The glossary** is a list whose items each start with the term in bold, then a colon and the
  definition: `- **Term**: definition`. The term is plain text, without links or formatting.
- **Every term linked is defined,** and two definitions can't differ only in case or spaces. A term
  defined but never linked is a warning.

Only `term:` links mark a term. Other uses of the word are left alone.

## Figures

A figure is an SVG, PNG, JPEG, GIF or WebP file directly in `figures/`, named with one of the
endings `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`, in lower case. Lo reads its type from
its first bytes, and they must be of the type its name says. A figure that isn't there as a file, of
another type, or past a limit, is left out, with a note in its place.

- **SVG figures** follow `figures.md`, in UTF-8. Lo keeps only what a figure may hold: no scripts,
  styles, outside images or addresses, `<foreignObject>`, filters or gradients. A figure Lo had to
  change, or refused whole, is left out, since a figure missing some of what it draws can mislead. A
  color other than Lo's named colors, `var(--fig-*)`, doesn't follow the reader's theme, and is a
  warning.
- **Image figures**, such as screenshots, are shown as they are. Lo reads their size from their
  header alone, and never decodes them to check them: a PNG's `IHDR` chunk, a JPEG's frame header, a
  WebP's first chunk, or a GIF's screen, grown to take in its first frame. A figure whose header is
  damaged or cut short is left out. A JPEG or PNG is turned as its Exif orientation says, and an
  animated image shows its first frame, still.
- **Parts** are an SVG's elements, each named by its id: a shape, a group or a text, but not the
  figure itself, its `<defs>`, a marker or what a marker draws, or a `<tspan>`. An id names an
  element in its own figure only, and an id two elements have names neither. A part that names no
  element Lo can link isn't linked.

## Markdown

Everything else is GitHub's Markdown: paragraphs, lists, tables, quotes, emphasis, inline code, task
lists, footnotes, alerts and links.

- **Fenced code blocks** are illustrations, such as pseudo-code, and are labeled so.
- **Raw HTML** shows as its text, with a warning.
- **Images** from outside GitHub show as links, with a warning: loading them would tell their server
  who's reading. Show the overview's own images with `:::figure`, never `![]()`.
- **Newlines** inside a paragraph are spaces, as in a README.

## Limits

Past any of these, Lo doesn't show the overview, and says why. It never cuts one short.

| What                                   | At most                       |
| -------------------------------------- | ----------------------------- |
| `artifact.md`                          | 256 KiB of UTF-8              |
| The overview's tree                    | 65,536 pieces, nested 16 deep |
| Targets                                | 500                           |
| Blocks inside blocks                   | 4 deep                        |
| A block's argument, or a link's target | 1,024 bytes                   |
| A code block's or a step's lines       | 200                           |
| Figures                                | 100                           |
| Steps in a walkthrough                 | 50, and at least 3            |
| Tabs in a `:::tabs` block              | 12, and at least 2            |
| The commit, figures included           | 50 MiB, 500 files and folders |

The tree's pieces are what Lo shows: each paragraph, heading, list item, link, run of text and block
counts as one, and each level of a list, quote or block inside another is a level of nesting.

Past these, Lo shows the overview without the one block or figure, with a note in its place:

| What                             | At most                             |
| -------------------------------- | ----------------------------------- |
| A file a target names            | 10 MiB of text                      |
| The files targets name, together | 64 MiB                              |
| An image                         | 10 MiB, 16,384 pixels a side, 40 MP |
| An SVG                           | 512 KiB, 4,096 elements, 32 deep    |
| The SVGs figures show, together  | 2 MiB                               |
| What SVG figures draw, together  | 4 times what one SVG may draw       |

A file a target names is text unless one of its first 8 KiB is a NUL byte. The files targets name
count in the order the overview first names them, and a file named only whole, by a link, counts for
nothing. SVGs count in the order the overview first shows them, each once however often it's shown,
but what they draw counts each time a block shows one. An SVG also may be no taller than 8 times its
width or wider than 32 times its height, and what it draws is capped.

## Versions

The header's `format` says which version of this format the overview is written in. A change that an
earlier version of Lo would read wrongly makes a new format. Each version of Lo reads every format
up to its own, and says it needs an update for a newer one. Of an overview in a newer format, Lo
reads only the header: a newer format may allow files, or limits, that this one doesn't, so its
commit isn't held to this format's rules either.
