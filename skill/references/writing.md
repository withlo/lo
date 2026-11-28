# Writing an overview

This file says how to write an overview's prose. Its rules are the skill's defaults: the
repository's instructions and yours come first (`SKILL.md`, step 4), and where one of them says
otherwise, follow it. The tl;dr comes first whatever any of them says.

The reader is reviewing the pull request, with its diff beside the overview. They read the overview
to learn what the change is for, how it works and where to look. Write what the diff doesn't say.

Each rule has a before and an after. The examples come from one pull request, in which requests over
a tenant's quota wait for a token instead of failing at once.

## What to say

### 1. What changed and why, first

Open the tl;dr, and each section, with what the change does and why. How it does it comes after, for
the reader who reads on.

- Before: This PR refactors `limiter.ts` to add a `Bucket` class with `take()` and `refill()`, and
  updates `handler.ts` to await `take()` before forwarding, so requests over the quota now wait.
- After: Requests over a tenant's quota now wait for a token instead of failing, so short bursts no
  longer end in errors. `handler.ts` takes a token from the tenant's bucket before it forwards a
  request.

### 2. Only what the reviewer needs

Cut what answers a question nobody had: what the change leaves alone, a bug fixed on the way that
the diff doesn't show, a defence of a choice nobody questioned. Say what doesn't change only when
the diff makes a reviewer expect it to.

- Before: This doesn't touch billing, and no public API changes. An earlier version of this branch
  dropped requests during a deploy, which is now fixed.
- After: Cut, both sentences. Write "The quota itself is unchanged." only when the diff touches
  `quota.ts`, so that a reviewer would wonder.

### 3. Concrete: the file, the function, the value, the case

Name what's there. Link the code, and give the number or the case.

- Before: The new logic handles edge cases around timing better.
- After: A request that arrives as a token comes back now takes it, in
  [`take()`](code:src/limiter.ts#L46-L58). Before, it waited for the next refill, up to a second.

### 4. Whose claim it is

Say whose each claim is that you didn't see for yourself: the description's, a reviewer's or the
author's agent's. A command the transcript copy shows the agent ran is its run. What only the
handoff file says is the agent's word. Say "passed" only for a run that you, or the transcript, saw
end that way.

- Before: All tests pass, and the change was load tested.
- After: The checks on this commit pass. The author's agent ran `pnpm test`, which passed. It says
  it also ran the burst tests by hand. The description says it was load tested at 2,000 requests a
  second, and gives no results.

### 5. What isn't known, as a fact

No hedging: "may", "might", "likely", "seems", "should", "probably", "appears to". Say what's known
plainly. Say what isn't known once, as a fact, where it applies.

- Before: This should work on Linux, and probably doesn't affect the retry path.
- After: Not run on Linux. The retry path calls `take()` too, and no test covers it.

## How to say it

### 6. The code's own names

Call each thing by the name the code gives it, in code formatting: `Bucket`, `take()`,
`quota.burst`. Don't coin a label for a part of the change. A word a reviewer new to this code
wouldn't know is a term: define it in the glossary before you rely on it.

- Before: The wait-path guard now runs ahead of the forward step.
- After: `handler.ts` now calls `bucket.take()` before `forward()`.

### 7. One word per thing

Once you've named a thing, keep that name. Where the repository's definitions have a term for it,
use theirs, every time.

- Before: Each tenant gets a bucket. The token pool refills every second, and when the allowance
  runs out, requests wait.
- After: Each tenant gets a [bucket](term:bucket). It refills every second, and when it's empty,
  requests wait.

### 8. Short sentences, one idea each

Split a sentence over about 25 words. Keep the words that show why one sentence follows another:
because, so, but, unless.

- Before: The limiter, which now keeps one bucket per tenant rather than one global counter, takes a
  token before each request is forwarded and, if none is free, parks the request on a queue that
  `refill()` drains in arrival order.
- After: The limiter keeps one bucket per tenant. It takes a token before it forwards a request. If
  none is free, the request waits in a queue, and `refill()` lets the oldest go first.

### 9. No stock phrases or filler

Cut words that announce the text instead of saying it, and words that say nothing: "This PR
introduces", "In this section", "It's worth noting that", "Importantly", "In order to", "leverage",
"utilize", "seamless", "robust", "comprehensive", "genuinely", "actually". Write "is" for "serves
as", and end a sentence where its fact ends, without a tail such as ", ensuring that…".

- Before: This PR introduces a robust mechanism that leverages token buckets in order to seamlessly
  handle bursts, ensuring a better experience for tenants.
- After: Requests in a burst wait for a token instead of failing.

### 10. Literal, not figurative

Say what the code does in plain words. A figure of speech makes the reader translate it back:
"load-bearing", "earns its keep", "the heart of", "under the hood", "quietly", "surfaces" for shows,
"seam" for boundary, "the shape of".

- Before: The bucket is the load-bearing piece here: it quietly absorbs bursts and surfaces
  backpressure to callers.
- After: Everything else depends on the bucket. It holds a burst's requests until tokens come back,
  so callers see slower answers instead of errors.

### 11. No inflated significance or praise

Don't grade the change: "significantly improves", "elegant", "powerful", "a critical fix", "greatly
simplifies". Give the fact the grade stood for, or nothing.

- Before: This significantly improves reliability with an elegant, powerful design.
- After: In the new burst test, all 50 requests over the quota get an answer. Before, 38 failed.

### 12. No rhetorical setups

Say what's there. No "not X, but Y" or "it isn't just X, it's Y" against a claim nobody made, no
question answered in the next sentence, no list of three for its rhythm, and no closing line that
sums up. A contrast stays when the reader holds the first half, as with the old behaviour.

- Before: This isn't just a rate limiter change. It's a rethink of how we handle load. The result?
  Fewer errors, happier tenants and calmer nights on call.
- After: Requests over the quota wait instead of failing, so a burst no longer ends in errors.

### 13. Plain formatting

Bold only to lead a list item. Headings in sentence case: "How it works", not "How It Works". No
emoji, no horizontal rules, and no bold or italics for emphasis in a sentence. A list is for
parallel items or steps, a table for a comparison, and prose for reasoning. Em dashes are fine.

- Before: `## 🚀 How It Works`, then: The **key insight** is that each tenant gets its _own_ bucket.
- After: `## How it works`, then: Each tenant gets a bucket of its own.

### 14. As short as the change allows

Length follows the change. A one-line fix gets a two-sentence tl;dr and little else, and a section
with nothing to say is left out. Short comes from leaving things out, never from fragments: write
whole sentences, and don't chain steps with arrows.

- Before: Bucket → `take()` → wait → forward. Fast. Simple.
- After: The handler takes a token from the bucket, waits if none is free, then forwards the
  request.

## Reading it again

The skill's last step before checking reads the overview again against these rules. Read it from the
top as the reviewer would, and for each sentence ask:

- Does the reviewer need it (rule 2), and does it come where they'd look for it (rule 1)?
- Is it a fact you can point to, said as whose it is (rules 3, 4 and 5)?
- Does it use the code's names and the repository's terms (rules 6 and 7)?
- Does it break rules 8 to 14?

Fix what fails, then read the fixed sentences once more. Don't overcorrect:

- Keep a connective the reasoning needs.
- Keep what isn't known, said as a fact (rule 5), rather than dropping it to sound sure.
- Never swap one stock phrase for another: "load-bearing" for "critical" is the same mistake.
- Keep each term the glossary defines, and its links.

## Sources

The rules are Lo's own, drawing on the writing rules of Lo's interface (`design/writing.md` in
`withlo/lo`). Rules 2, 9, 10 and 12, and what not to overcorrect, draw ideas and some wording from
the refine-prose and clean-copy skills in
[petekp/claude-code-setup](https://github.com/petekp/claude-code-setup), Copyright (c) 2024 Pete
Petrash, under the MIT License.
