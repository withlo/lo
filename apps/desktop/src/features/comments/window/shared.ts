// What the comments share with other features' window code: a post's text, as threads and the
// timeline draw it, from GitHub's rendering of it once main has read that; a comment box's
// preview and attached files, for a box outside the diff, such as the submit dialog's summary; and
// writing on a pull request itself, for its timeline: the box at the timeline's end, editing and
// deleting your comments there, and what your own writes there changed, which the timeline shows
// at once; the thread a review's first comment is in, for Show in diff; choosing Vim keys and how
// threads show in code, for the welcome; and the comment on a file a refused line offers, for a
// key that would take its `⏎`.

import { createElement, type ReactNode } from 'react';

import { choiceOf } from '../../settings/window/shared.ts';
import { type PullTab, useTabState } from '../../tab/window/shared.ts';
import { threads } from '../settings.ts';
import {
  Dropzone as DropzoneOf,
  UploadRows as UploadRowsOf,
  useUploads as uploadsOf,
} from './Attached.tsx';
import type { BoxUploads } from './Attached.tsx';
import { takeOffer } from './boxes.ts';
import { boxKeys as keysOf, type BoxKey } from './boxkeys.ts';
import {
  editOnPull,
  focusPullBox,
  type PullComment,
  pullChangeRefusal,
  removeOnPull,
} from './conversation.ts';
import { Post as PostText, type PostProps } from './Post.tsx';
import { Preview as PreviewText, type PreviewProps } from './Preview.tsx';
import {
  PullBox,
  type PullBoxProps,
  PullEdit,
  type PullEditProps,
  PullNote,
  type PullNoteProps,
  useEditingOnPull,
} from './TimelineBox.tsx';
import {
  attachFiles as attach,
  draggingOver as dragging,
  endUploads as end,
  pickFiles as pick,
  takeAddresses as addresses,
  uploadsHold as hold,
  type Attachable,
  type UploadsHold,
} from './uploads.ts';
import { chooseVimKeys as chooseVim } from './vim.ts';
import { onPull, readBeforeWith, settleOnPull, type OnPull, type SentBefore } from './onpull.ts';
import { held, threadOfReview } from './threads.ts';
import { onPullWrite, type PullWrite } from './written.ts';

export type { PostRef } from './bodies.ts';
export type { BoxKey } from './boxkeys.ts';
export type { PullComment } from './conversation.ts';
export type { PostProps, PostPull } from './Post.tsx';
export type { PreviewProps } from './Preview.tsx';
export type { Attachable, UploadsHold } from './uploads.ts';
export type { BoxUploads } from './Attached.tsx';
export type { PullBoxProps, PullEditProps, PullNoteProps } from './TimelineBox.tsx';
export type { PullWrite } from './written.ts';
export type { OnPull, SentBefore } from './onpull.ts';

/**
 * The review thread review `review`'s first comment is in, by the review's ID, in pull request's
 * tab `tab`, among the threads main has sent. None while the threads aren't read, or when none of
 * their comments came with it.
 */
export function firstThreadOf(tab: string, review: string): string | undefined {
  return threadOfReview(held.get(tab).threads?.threads ?? [], review);
}

/**
 * A post's text, drawn as GitHub draws it, from its HTML, which the post asks main for as it comes
 * on screen or near it, as the view's account, and from its Markdown until then. A post whose
 * Markdown holds an HTML tag shows three skeleton lines until then instead, unless the window sent
 * or saved its text, or no HTML is coming. The HTML stays in the window's memory only, until the
 * view's tab closes, and is read again while the post's images are on screen, before their
 * addresses lapse. Links open through main.
 */
export function Post(props: PostProps): ReactNode {
  return createElement(PostText, props);
}

/**
 * A comment box's text as GitHub would render it, for its preview: made in the background, with
 * the pull request's repository as what references refer to, and as plain text until it's made.
 */
export function Preview(props: PreviewProps): ReactNode {
  return createElement(PreviewText, props);
}

/**
 * One of a comment box's own keys, as this system shows it, read from the declaration of the keys
 * its editor handles itself: for a frame that shows them.
 */
export function boxKeys(name: BoxKey): string[] {
  return keysOf(name);
}

/**
 * Attaches `files`, dropped on comment box `box` or pasted into it: each a placeholder at its
 * cursor at once, which becomes the Markdown that shows it once main has uploaded it.
 */
export function attachFiles(box: Attachable, files: readonly File[]): void {
  attach(box, files);
}

/** "Attach" (`⌘⇧A`) in comment box `box`: picks files with the system's picker, and attaches them. */
export function pickFiles(box: Attachable): void {
  pick(box);
}

/** Files are dragged over comment box `box`: how many, or 0 once they're dropped or leave. */
export function draggingOver(box: Attachable, count: number): void {
  dragging(box, count);
}

/**
 * Why what comment box `box` is in isn't sent yet for its files, if it isn't: a file is still on its
 * way in.
 */
export function uploadsHold(box: Attachable): UploadsHold | undefined {
  return hold(box);
}

/**
 * Gives up every file still on its way into comment box `box`, and forgets them all, as what it's
 * in is sent or discarded.
 */
export function endUploads(box: Attachable): void {
  end(box);
}

/**
 * While `box`'s view takes no uploads, an image's `https` address pasted or dropped into it goes in
 * as an image. Listens on `frame`, the box's element; returns what stops it.
 */
export function takeAddresses(frame: HTMLElement, box: Attachable): () => void {
  return addresses(frame, box);
}

/**
 * What comment box `box`'s frame shows of its files, while its text is `text`: notes, "Attach" with
 * `keys`, and why it isn't sent yet for them.
 */
export function useUploads(box: Attachable, keys: readonly string[], text: string): BoxUploads {
  return uploadsOf(box, keys, text);
}

/** Each file attached to comment box `box`, uploading or uploaded, with "Cancel" or "Insert". */
export function UploadRows(props: { box: Attachable }): ReactNode {
  return createElement(UploadRowsOf, props);
}

/** How many files would be attached, while they're dragged over comment box `box`. */
export function Dropzone(props: { box: Attachable }): ReactNode {
  return createElement(DropzoneOf, props);
}

/**
 * The box at the end of a pull request's timeline, which comments on the pull request itself as
 * the tab's account: its draft kept as every comment box's is, and posted at once with `⌘⏎`, as it
 * joins no review.
 */
export function PullCommentBox(props: PullBoxProps): ReactNode {
  return createElement(PullBox, props);
}

/** The box that edits your comment on the pull request, in its card, while it's open. */
export function PullCommentEdit(props: PullEditProps): ReactNode {
  return createElement(PullEdit, props);
}

/** What your comment's card says while its delete's answer was lost, if anything. */
export function PullCommentNote(props: PullNoteProps): ReactNode {
  return createElement(PullNote, props);
}

/** The comments on a view's pull request whose edit boxes are open, by their node IDs. */
export function useEditsOnPull(view: string): ReadonlySet<string> {
  return useEditingOnPull(view);
}

/**
 * Why the tab's account can't edit or delete `comment`, in Lo's words: nothing when it's theirs and
 * GitHub lets them.
 */
export function whyNotChange(
  comment: PullComment,
  login: string | undefined,
  change: 'edit' | 'delete',
): string | undefined {
  return pullChangeRefusal(comment, login, change);
}

/** Opens a box with your comment's text, in its card, to edit it, as `i` does. */
export function editPullComment(tab: PullTab, comment: PullComment): Promise<void> {
  return editOnPull(tab, comment);
}

/** Asks before deleting your comment, and deletes it once you say so, as `dd` does. */
export function deletePullComment(tab: PullTab, comment: PullComment): void {
  removeOnPull(tab, comment);
}

/**
 * `⏎` just after a line refused a comment, as the toast offers it, for a feature whose own `⏎` on
 * the line would take the key first: a comment on the file instead. Says whether there was one.
 */
export function takeFileOffer(tab: PullTab): boolean {
  return takeOffer(tab);
}

/** Puts focus in the box at the end of the tab's timeline, as `c` there does. */
export function focusCommentBox(tab: PullTab): void {
  focusPullBox(tab);
}

/**
 * The comments the reader sent from the box at the end of view `view`'s timeline, and the edits of
 * their comments there, that the timeline on screen doesn't show yet: from the moment each is sent
 * until it says it does ({@link settleSent}), or one GitHub took has waited five minutes.
 */
export function useSentOnPull(view: string): readonly OnPull[] {
  return useTabState(onPull, view);
}

/** View `view`'s timeline on screen shows what `keys` sent, or lets them go. */
export function settleSent(view: string, keys: ReadonlySet<string>): void {
  settleOnPull(view, keys);
}

/**
 * Has `read` say what view `view`'s timeline on screen holds of the reader's comments with the
 * text `text`, as one is sent from the box at its end, which tells GitHub's copy of it: nothing
 * while it has none.
 */
export function readSentBefore(read: (view: string, text: string) => SentBefore | undefined): void {
  readBeforeWith(read);
}

/**
 * Tells `listener` of each of the reader's writes to a pull request itself that GitHub takes, until
 * the returned function.
 */
export function onCommentWritten(listener: (view: string, write: PullWrite) => void): () => void {
  return onPullWrite(listener);
}

/**
 * Turns Vim keys on or off, as `on` says, as "Vim keys" in the command palette switches them. The
 * last of several choices made in a row is the one that stays. Resolves `false` when it couldn't,
 * which it has said.
 */
export function chooseVimKeys(on: boolean): Promise<boolean> {
  return chooseVim(on);
}

/**
 * How review threads show in code, beside lines or between them, as a screen besides Settings
 * offers it: the welcome offers it as cards, each with a line on what its picture can't show.
 */
export const threadsChoice = choiceOf(threads, {
  beside: 'A mark beside the code. Point at it or click it to read the thread.',
  between: 'The whole thread under its line, as on GitHub.',
});
