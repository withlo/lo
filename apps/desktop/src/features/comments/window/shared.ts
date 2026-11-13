// What the comments share with other features' window code: a post's text, as threads and the
// timeline draw it, from GitHub's rendering of it once main has read that.

import { createElement, type ReactNode } from 'react';

import { Post as PostText, type PostProps } from './Post.tsx';

export type { PostRef } from './bodies.ts';
export type { PostProps, PostPull } from './Post.tsx';

/**
 * A post's text, drawn as GitHub draws it, from its HTML, which the post asks main for as it comes
 * on screen or near it, as the view's account, and from its Markdown until then. The HTML stays in
 * the window's memory only, until the view's tab closes, and is read again while the post's images
 * are on screen, before their addresses lapse. Links open through main.
 */
export function Post(props: PostProps): ReactNode {
  return createElement(PostText, props);
}
