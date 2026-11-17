// What the window knows of each view's merge status, as main last said, and of its merge panel:
// whether it's open, the reason the keyboard is on, the method chosen, the squash commit's text as
// GitHub would start it and as the reader typed it. What's typed is kept until the tab closes.
// Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import { tabState } from '../../tab/window/shared.ts';
import type { MergeStatusView, MergeView, Method } from '../contract.ts';

export interface StatusState {
  /** Each view's status, by its id, as main last said. */
  readonly views: ReadonlyMap<string, MergeView>;
}

export const statuses = createStore<StatusState>()(() => ({ views: new Map() }));

/** Takes a view's status as main says it. */
export function takeStatus({ id, view }: MergeStatusView): void {
  const views = new Map(statuses.getState().views);
  views.set(id, view);
  statuses.setState({ views });
}

/** Forgets a closed view's status. */
export function forgetStatus(id: string): void {
  if (!statuses.getState().views.has(id)) return;
  const views = new Map(statuses.getState().views);
  views.delete(id);
  statuses.setState({ views });
}

/**
 * The squash commit's text as GitHub would start it, for the head and title it was read at:
 * being read, read, or why GitHub didn't say.
 */
export type Squash =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading'; readonly at: string }
  | {
      readonly kind: 'read';
      readonly at: string;
      readonly title: string;
      readonly message: string;
    }
  | { readonly kind: 'failed'; readonly at: string; readonly why: string };

/** A view's merge panel. */
export interface Panel {
  readonly open: boolean;
  /** The reason the keyboard is on, by its row's key. */
  readonly focused: string | undefined;
  /** The method chosen in the panel, until another is. */
  readonly method: Method | undefined;
  /** The squash commit's title and message as the reader typed them: empty leaves GitHub's. */
  readonly title: string;
  readonly message: string;
  readonly squash: Squash;
}

export const panels = tabState<Panel>(() => ({
  open: false,
  focused: undefined,
  method: undefined,
  title: '',
  message: '',
  squash: { kind: 'none' },
}));
