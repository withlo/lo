// Scopes are names on the DOM: the nearest `[data-lo-scope]` around the focused element says which
// commands its keys can run. A scope's element can also have a source: a code view's `KeySource`,
// which reports Vim's state, or a `TargetSource` for what a key there acts on.

import type { Target } from './targets.ts';

/** The attribute that names a scope. */
export const SCOPE_ATTRIBUTE = 'data-lo-scope';

/**
 * The engine's own scopes. `window` is wherever no other scope is; `dialog` keeps the browser's
 * `Tab`; in `menu`, `j` and `k` move as `↓` and `↑` do.
 */
export const engineScopes = ['window', 'menu', 'dialog', 'palette'] as const;

/** The code views' scopes, whose elements have a `KeySource`. */
export const codeScopes = ['diff', 'file', 'peek', 'box'] as const;

/**
 * The attribute that gives a scope the browser's `Tab`, as `data-lo-tab="browser"`: a form, such
 * as Settings', whose fields `Tab` moves between.
 */
export const TAB_ATTRIBUTE = 'data-lo-tab';

/** A code view's Vim mode. */
export type Mode = 'normal' | 'visual' | 'insert';

/** What the registry asks of every code view. */
export interface KeySource {
  /**
   * Vim's state: its mode, whether it's in the middle of a command (after a count or an
   * operator), the count when that's all Vim holds, and what a key there acts on: the cursor's
   * line, the lines `v` selected, a thread.
   */
  keyState(): { mode: Mode; pending: boolean; count?: number | undefined; target: Target };
  /** Keys the registry held back, replayed into Vim, in Vim's key notation (`y`, `<C-o>`). */
  passKeys(keys: readonly string[]): void;
  /**
   * Drops whatever Vim is waiting on: a count, an operator, a key replayed into it. The registry
   * calls it when focus leaves the view, the window loses focus or the tab changes, so no key
   * typed before then completes a command after, and when one of Lo's commands takes Vim's count.
   */
  clearPending(): void;
  /** The keys Vim runs Lo's motions with and the keymap's `vim` lines: after a remap, and at first. */
  setVimKeys(keys: readonly VimKey[]): void;
}

/** What a key acts on in a scope that isn't a code view: the tree's focused file, say. */
export interface TargetSource {
  target(): Target;
}

export type ScopeSource = KeySource | TargetSource;

/**
 * A key Vim takes in a code view, in Vim's key notation: one of Lo's motions (`vim: 'motion'`)
 * under its current keys, which Vim runs so that counts and visual mode work, or a line of the
 * keymap file's that maps Vim's own keys.
 */
export type VimKey =
  | { readonly kind: 'motion'; readonly command: string; readonly keys: string }
  | { readonly kind: 'map'; readonly mode: Mode; readonly keys: string; readonly to: string };

const sources = new WeakMap<Element, ScopeSource>();

/**
 * Makes `source` answer for the scope `element` names. Returns a function that takes it back,
 * for when the view goes. The element keeps its `data-lo-scope`, which the caller sets.
 */
export function setScopeSource(element: Element, source: ScopeSource): () => void {
  sources.set(element, source);
  return () => {
    if (sources.get(element) === source) sources.delete(element);
  };
}

export function isKeySource(source: ScopeSource | undefined): source is KeySource {
  return source !== undefined && 'keyState' in source;
}

/** The scope around `element`: the nearest one named on the DOM, or `window`. */
export interface FoundScope {
  readonly name: string;
  readonly element: Element | undefined;
  readonly source: ScopeSource | undefined;
}

export function findScope(element: Element | null | undefined): FoundScope {
  const found = element?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? undefined;
  const name = found?.getAttribute(SCOPE_ATTRIBUTE);
  if (!found || !name) return { name: 'window', element: undefined, source: undefined };
  return { name, element: found, source: sources.get(found) };
}

/** What a key in `scope` acts on. */
export function scopeTarget(scope: FoundScope): Target {
  const { source } = scope;
  if (source === undefined) return { kind: 'none' };
  return isKeySource(source) ? source.keyState().target : source.target();
}

/** Input types that don't take text. */
const notText = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * What kind of text `element` takes, if any: a form `field` (an input that takes text, or a text
 * area) or `editable` content. A code view's own text is editable content; a field inside one,
 * such as Vim's `/` and `:` prompt, is a field.
 */
export type TextKind = 'field' | 'editable';

export function textKind(element: Element | null | undefined): TextKind | undefined {
  if (!element) return undefined;
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea') return 'field';
  if (tag === 'input') {
    return notText.has((element.getAttribute('type') ?? 'text').toLowerCase())
      ? undefined
      : 'field';
  }
  const editable = element.closest('[contenteditable]');
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
    ? 'editable'
    : undefined;
}

/** Whether `element` takes typed text: an input, a text area or editable content. */
export function isTextField(element: Element | null | undefined): boolean {
  return textKind(element) !== undefined;
}

/**
 * Whether the system's Edit menu (cut, copy, paste, spelling) is `element`'s right-click menu,
 * rather than Lo's: a form field (an input that takes text, or a text area), and editable content
 * outside a code view, such as a comment box's text. A code view's own text is editable content
 * too, but it is code: in a diff, a file or a peek, and in CodeMirror's text wherever it is, a
 * right-click gets Lo's menu for the line.
 */
export function hasEditMenu(element: Element | null | undefined): boolean {
  const kind = textKind(element);
  if (kind === undefined) return false;
  if (kind === 'field') return true;
  const scope = findScope(element).name;
  if (scope === 'box') return true;
  return !readingScopes.includes(scope) && element?.closest('.cm-content') === null;
}

/** The code views that are read, not written in. A comment box is the one that's written in. */
const readingScopes: readonly string[] = codeScopes.filter((scope) => scope !== 'box');

/**
 * Whether an unhandled `Tab` pressed on `element`, in `scope`, is ended rather than moving focus:
 * focus moves through Lo's scopes only by commands, so a box can't hand its next letters to the
 * diff, nor the tree its keys to whatever follows it. A `dialog`, a scope marked
 * `data-lo-tab="browser"` and a form field outside any other scope keep the browser's `Tab`.
 */
export function endsTab(scope: FoundScope, element: Element | null | undefined): boolean {
  if (scope.name === 'dialog') return false;
  if (scope.element?.getAttribute(TAB_ATTRIBUTE) === 'browser') return false;
  return !(scope.name === 'window' && isFormField(element));
}

/** Whether `element` is a form field: an input, a list to choose from or a text area. */
function isFormField(element: Element | null | undefined): boolean {
  const tag = element?.tagName.toLowerCase();
  if (tag === 'select' || tag === 'textarea') return true;
  return tag === 'input' && element?.getAttribute('type')?.toLowerCase() !== 'hidden';
}
