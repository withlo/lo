// What the comments share with other features' window code: a post's text, as threads and the
// timeline draw it, from GitHub's rendering of it once main has read that; and a comment box's
// preview and attached files, for a box outside the diff, such as the submit dialog's summary.

import { createElement, type ReactNode } from 'react';

import {
  Dropzone as DropzoneOf,
  UploadRows as UploadRowsOf,
  useUploads as uploadsOf,
} from './Attached.tsx';
import type { BoxUploads } from './Attached.tsx';
import { Post as PostText, type PostProps } from './Post.tsx';
import { Preview as PreviewText, type PreviewProps } from './Preview.tsx';
import {
  attachFiles as attach,
  draggingOver as dragging,
  pickFiles as pick,
  takeAddresses as addresses,
  uploadsRunning as running,
  type Attachable,
} from './uploads.ts';

export type { PostRef } from './bodies.ts';
export type { PostProps, PostPull } from './Post.tsx';
export type { PreviewProps } from './Preview.tsx';
export type { Attachable } from './uploads.ts';
export type { BoxUploads } from './Attached.tsx';

/**
 * A post's text, drawn as GitHub draws it, from its HTML, which the post asks main for as it comes
 * on screen or near it, as the view's account, and from its Markdown until then. The HTML stays in
 * the window's memory only, until the view's tab closes, and is read again while the post's images
 * are on screen, before their addresses lapse. Links open through main.
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

/** Whether a file is still on its way into comment box `box`, so what it's in isn't sent yet. */
export function uploadsRunning(box: Attachable): boolean {
  return running(box);
}

/**
 * While `box`'s view takes no uploads, an image's `https` address pasted or dropped into it goes in
 * as an image. Listens on `frame`, the box's element; returns what stops it.
 */
export function takeAddresses(frame: HTMLElement, box: Attachable): () => void {
  return addresses(frame, box);
}

/** What comment box `box`'s frame shows of its files: notes, "Attach" with `keys`, and whether one uploads. */
export function useUploads(box: Attachable, keys: readonly string[]): BoxUploads {
  return uploadsOf(box, keys);
}

/** Each file attached to comment box `box`, uploading or uploaded, with "Cancel". */
export function UploadRows(props: { box: Attachable }): ReactNode {
  return createElement(UploadRowsOf, props);
}

/** How many files would be attached, while they're dragged over comment box `box`. */
export function Dropzone(props: { box: Attachable }): ReactNode {
  return createElement(DropzoneOf, props);
}
