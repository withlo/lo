// The review feature in main: the submit dialog's view of a pull request, read as it opens; its
// summary, kept through the comments feature's drafts; and submitting your review, in its turn
// among the comments feature's writes to the pull request (`./submitter.ts`). When GitHub's answer
// is lost, your latest reviews are read afresh (`YourReviews`) to find out whether it was
// submitted, with GitHub's clock as that answer gives it.

import { YourReviewsDocument } from '@lo/github';

import { defineFeature } from '../../../main/features.ts';
import { github } from '../../accounts/service.ts';
import { drafts, reviews } from '../../comments/service.ts';
import { comparisons } from '../../revisions/service.ts';
import { tabs } from '../../tab/service.ts';
import { contract } from '../contract.ts';
import { type ReviewNode, Submitter } from './submitter.ts';

const log = (line: string) => console.error(`review: ${line}`);

let submitter: Submitter | undefined;
const stops: (() => void)[] = [];

/** What `start` made, for a handler: the window asks nothing before main has started. */
function started(): Submitter {
  if (submitter === undefined) throw new Error('The review feature hasn’t started.');
  return submitter;
}

export default defineFeature(contract, {
  uses: [github, tabs, comparisons, reviews, drafts],
  handlers: {
    dialog: ({ id }) => started().dialog(id),
    draft({ id, text }) {
      started().draft(id, text);
    },
    submit: ({ id, event, body, anyway }) => started().submit(id, event, body, anyway),
  },
  start({ use, publish }) {
    const service = use(tabs);
    const made = new Submitter({
      view: (id) => service.pull(id),
      onScreen(id) {
        const on = use(comparisons).onScreen(id);
        return on.kind === 'revisions' ? on.comparing.new.head : service.pull(id)?.shown;
      },
      poller: (login) => use(github).poller(login),
      reviews: use(reviews),
      drafts: use(drafts),
      async readReviews(login, pull) {
        const poller = await use(github).poller(login);
        const { owner, name } = pull.repo;
        const read = await poller.readOnce(async (client) => ({
          data: await client.graphql(YourReviewsDocument, {
            owner,
            name,
            number: pull.number,
            login,
          }),
          ahead: client.githubAhead(),
        }));
        const nodes = read.data.repository?.pullRequest?.reviews?.nodes ?? [];
        return {
          reviews: nodes.flatMap((node): ReviewNode[] =>
            node
              ? [{ id: node.id, state: node.state, body: node.body, submittedAt: node.submittedAt }]
              : [],
          ),
          ahead: read.ahead,
        };
      },
      publish: (submission) => publish('submitted', submission),
      log,
    });
    submitter = made;
    stops.push(service.onPull((id) => made.follow(id)));
    // Once every feature has started, the comments' drafts among them: a review sent before Lo
    // quit, whose answer was lost, is looked for.
    queueMicrotask(() => {
      if (submitter !== made) return;
      made.resume();
      for (const tab of service.list().tabs) if (tab.kind === 'pull') made.follow(tab.id);
    });
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    submitter?.stop();
    submitter = undefined;
  },
});
