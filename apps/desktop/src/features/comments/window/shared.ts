// What the comments share with other features' window code: a post's text, as threads and the
// timeline draw it, from GitHub's rendering of it once main has read that; and a comment box's
// preview, for a box outside the diff, such as the submit dialog's summary.

import { createElement, type ReactNode } from 'react';

import { Post as PostText, type PostProps } from './Post.tsx';
import { Preview as PreviewText, type PreviewProps } from './Preview.tsx';

export type { PostRef } from './bodies.ts';
export type { PostProps, PostPull } from './Post.tsx';
export type { PreviewProps } from './Preview.tsx';

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
