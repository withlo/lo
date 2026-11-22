// Writing on a pull request itself, in its timeline: `c` puts focus in the box at the timeline's
// end, which comments on the pull request; `i` on one of your comments there opens a box with its
// text in its card, which saves over it only while GitHub still has the text it started from; `dd`
// asks first, in the dialog a review comment's delete asks in, and deletes it once you say so. Lo
// changes only your own comments, even where GitHub would let you change someone else's: those
// refuse in Lo's words, as do comments GitHub doesn't let you change.

import { changeRefusal } from '@lo/review';

import { refuse } from '../../../window/commands/notices.tsx';
import type { PullTab } from '../../tab/window/shared.ts';
import type { EditPlaceRow } from '../contract.ts';
import { COULDNT_EDIT, failed, OFFLINE_ACT, setAsking, unfailed } from './acts.ts';
import {
  bringToTimeline,
  canWrite,
  inputsSoFar,
  knowPull,
  loginOf,
  offline,
  openInTimeline,
} from './boxes.ts';
import { main } from './main.ts';
import { actText } from './writing.ts';

/** A comment on the pull request itself, as the timeline shows it. */
export interface PullComment {
  readonly id: string;
  /** Its author's login: nothing for a deleted account. */
  readonly author: string | undefined;
  /** Its text, in Markdown. */
  readonly body: string;
  readonly viewerCanUpdate: boolean;
  readonly viewerCanDelete: boolean;
}

/**
 * Why `login` can't make `change` to `comment`, in Lo's words: nothing when it's theirs and GitHub
 * lets them. A view acting as nobody changes nothing.
 */
export function pullChangeRefusal(
  comment: PullComment,
  login: string | undefined,
  change: 'edit' | 'delete',
): string | undefined {
  const refused = changeRefusal(
    {
      id: comment.id,
      author: comment.author,
      body: comment.body,
      state: 'SUBMITTED',
      createdAt: '',
      url: '',
      hidden: undefined,
      viewerCanUpdate: comment.viewerCanUpdate,
      viewerCanDelete: comment.viewerCanDelete,
    },
    login ?? '',
    change,
  );
  if (refused === undefined) return undefined;
  switch (refused.refusal) {
    case 'theirs':
      return actText({ kind: 'theirs', author: refused.author ?? null }, change, login);
    case 'notAllowed':
    case 'noneOfYours':
      return actText({ kind: 'notAllowed', reasons: [] }, change, login);
    default:
      refused satisfies never;
      return actText({ kind: 'notAllowed', reasons: [] }, change, login);
  }
}

/** Whether tab `tab` may change `comment` now, saying why not. */
function may(tab: PullTab, comment: PullComment, change: 'edit' | 'delete'): boolean {
  const can = canWrite(tab.id);
  if (can !== true) {
    refuse(can);
    return false;
  }
  const why = pullChangeRefusal(comment, loginOf(tab.id), change);
  if (why !== undefined) {
    refuse(why);
    return false;
  }
  return true;
}

/**
 * `i` on your comment in tab `tab`'s timeline, or its Edit: a box with its text in its card. What
 * it starts from is GitHub's text as the card shows it, kept with the draft, and the edit is saved
 * over it only if GitHub still has it. An edit left open before goes on with its draft.
 */
export async function editOnPull(tab: PullTab, comment: PullComment): Promise<void> {
  if (!may(tab, comment, 'edit')) return;
  unfailed(tab.id, comment.id);
  const place: EditPlaceRow = { kind: 'edit', thread: null, comment: comment.id };
  try {
    const outcome = await main().editing({ id: tab.id, place, base: comment.body });
    if (outcome.kind === 'refused') {
      refuse(actText(outcome.refusal, 'edit', loginOf(tab.id)));
      return;
    }
  } catch (error) {
    failed(tab.id, comment.id, COULDNT_EDIT, error, () => void editOnPull(tab, comment));
    return;
  }
  knowPull(tab);
  openInTimeline(tab.id, place, comment.body);
}

/**
 * `dd` on your comment in tab `tab`'s timeline, or its Delete: asks first, showing its first line.
 * Nothing goes until the dialog's Delete is pressed, and then only while GitHub has it as asked.
 */
export function removeOnPull(tab: PullTab, comment: PullComment): void {
  if (!may(tab, comment, 'delete')) return;
  // Nothing would go: it's refused now, not after the question.
  if (offline(tab.id)) {
    refuse(OFFLINE_ACT);
    return;
  }
  setAsking({
    tab,
    thread: null,
    comment: comment.id,
    body: comment.body,
    pending: false,
    onlyComment: false,
  });
}

/** What puts focus in each view's box at the end of its timeline, while the timeline draws it. */
const focusers = new Map<string, () => void>();

/**
 * The views whose box was asked for focus before their timeline drew it, by how much the reader had
 * done then: it takes focus as it comes, if they've done nothing since.
 */
const awaited = new Map<string, number>();

/** Says what puts focus in view `view`'s box at its timeline's end, until the returned function. */
export function setPullBoxFocus(view: string, focus: () => void): () => void {
  focusers.set(view, focus);
  const asked = awaited.get(view);
  awaited.delete(view);
  if (asked !== undefined && asked === inputsSoFar()) queueMicrotask(focus);
  return () => {
    if (focusers.get(view) === focus) focusers.delete(view);
  };
}

/**
 * `c` in tab `tab`'s timeline: focus in the box at its end, brought on screen, or as the timeline
 * draws it. Says why not, when it can't take a comment.
 */
export function focusPullBox(tab: PullTab): void {
  const can = canWrite(tab.id);
  if (can !== true) {
    refuse(can);
    return;
  }
  // The draft is under the code block it was written on: it comes here, and takes focus as it does.
  if (bringToTimeline(tab.id)) return;
  const focus = focusers.get(tab.id);
  if (focus) focus();
  else awaited.set(tab.id, inputsSoFar());
}
