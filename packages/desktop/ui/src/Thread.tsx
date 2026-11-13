import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { Key, keyAria } from './Key.tsx';
import { Tag, type TagTone } from './Tag.tsx';
import { CommentIcon } from './ThreadCount.tsx';

/** One comment of a thread, as its card shows it. */
export interface ThreadComment {
  /** What identifies it, and what `onEdit` and `onDelete` name. */
  id: string;
  /** Who wrote it, by login. */
  author: string;
  /** The address of their picture. */
  image?: string | undefined;
  /** How long ago, as the card says it: "2 days ago". */
  when: string;
  /** It's yours: it says so, and offers Edit and Delete. No one else's does. */
  mine?: boolean | undefined;
  /** Written by the pull request's author. */
  byAuthor?: boolean | undefined;
  /** In your review, not sent yet. */
  pending?: boolean | undefined;
  /** The comment's text, already drawn: rendered Markdown, images and all. */
  body: ReactNode;
}

/** A short label beside a thread's state, such as "On a newer push". */
export interface ThreadTag {
  label: string;
  tone?: TagTone | undefined;
}

/**
 * The keys of a thread's actions, as this system shows each (`['x']`, `['d', 'd']`). An action with
 * no keys shows none.
 */
export interface ThreadKeys {
  /** Collapse and open. */
  toggle?: readonly string[] | undefined;
  reply?: readonly string[] | undefined;
  /** Resolve and unresolve. */
  resolve?: readonly string[] | undefined;
  /** Edit your newest comment in the thread. */
  edit?: readonly string[] | undefined;
  /** Delete your newest comment in the thread. */
  delete?: readonly string[] | undefined;
}

export interface ThreadProps {
  /** The comments, oldest first. */
  comments: readonly ThreadComment[];
  /** GitHub has it resolved. */
  resolved: boolean;
  /**
   * Open, with its comments, or collapsed to one line. Unresolved threads start open and resolved
   * ones collapsed; either can be changed.
   */
  open: boolean;
  /** Its line has changed since it was written. */
  outdated?: boolean | undefined;
  /** Others beside its state: "On a newer push". */
  tags?: readonly ThreadTag[] | undefined;
  /** The first comment's opening, as plain text, for the collapsed line. */
  excerpt?: string | undefined;
  /** The keyboard is on it: `]t` landed here. */
  focused?: boolean | undefined;
  /** You can resolve it, or unresolve it once it's resolved. */
  canResolve?: boolean | undefined;
  /** You can reply to it. */
  canReply?: boolean | undefined;
  keys?: ThreadKeys | undefined;
  /** An open reply box, in place of the row that offers one. */
  reply?: ReactNode;
  /** The collapse or the line was clicked. */
  onToggle?: (() => void) | undefined;
  onResolve?: (() => void) | undefined;
  onReply?: (() => void) | undefined;
  /** Edit or Delete was pressed on one of your comments, by its `id`. */
  onEdit?: ((id: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
  /** More classes for the card, such as the space the code view leaves around it. */
  className?: string | undefined;
}

const card = cva('max-w-read-measure overflow-hidden rounded-md text-fg', {
  variants: {
    view: {
      open: 'bg-bg-raised',
      // Collapsed, a thread steps back: it has no ground of its own.
      collapsed: 'bg-transparent',
    },
    ground: {
      rest: '',
      focused: 'shadow-ring',
    },
  },
  compoundVariants: [
    { view: 'open', ground: 'rest', class: 'ring-1 ring-border' },
    { view: 'collapsed', ground: 'rest', class: 'ring-1 ring-border-subtle' },
  ],
});

/** How many comments, and how many of them wait in your review. */
function counted(comments: readonly ThreadComment[]): string {
  const pending = comments.filter((each) => each.pending).length;
  const all = `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`;
  return pending > 0 && pending < comments.length ? `${all}, ${pending} pending` : all;
}

function replies(comments: readonly ThreadComment[]): string | undefined {
  const count = comments.length - 1;
  if (count <= 0) return undefined;
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? 'M3.5 10 8 5.5 12.5 10' : 'M3.5 6 8 10.5 12.5 6'} />
    </svg>
  );
}

/** What a button's keys say to a screen reader, and what they add to its tooltip. */
function withKeys(label: string, keys: readonly string[] | undefined) {
  return {
    title: keys === undefined ? label : `${label} (${keys.join(' ')})`,
    ...keyAria(keys, undefined),
  };
}

/**
 * A review thread: its comments, its state and a way to reply, under its line in the diff or on an
 * overview's code block. Unresolved threads start open and resolved ones collapsed to one line.
 * A comment's text is a slot for what's already drawn; Edit and Delete show only on your own
 * comments, and Resolve and Reply only where GitHub lets you.
 */
export function Thread({
  comments,
  resolved,
  open,
  outdated = false,
  tags = [],
  excerpt,
  focused = false,
  canResolve = false,
  canReply = false,
  keys = {},
  reply,
  onToggle,
  onResolve,
  onReply,
  onEdit,
  onDelete,
  className = '',
}: ThreadProps) {
  const [first] = comments;
  if (first === undefined) return null;
  // A thread you've begun in your review is only yours: there's nothing on GitHub to resolve yet.
  const pendingAll = comments.every((each) => each.pending);
  const state = pendingAll ? 'pending' : resolved ? 'resolved' : 'unresolved';
  const word = { pending: 'Pending', resolved: 'Resolved', unresolved: 'Unresolved' }[state];
  const newestMine = comments.findLast((each) => each.mine)?.id;
  const ground = focused ? 'focused' : 'rest';

  if (!open) {
    const said = replies(comments);
    return (
      <div
        role="group"
        aria-label={`${word} thread by ${first.author}`}
        data-thread-state={state}
        data-focused={focused ? '' : undefined}
        className={`${card({ view: 'collapsed', ground })} ${className}`}
      >
        <button
          type="button"
          aria-expanded={false}
          {...withKeys('Open the thread', keys.toggle)}
          className="flex h-32 w-full items-center gap-8 px-12 text-start text-fg-muted text-small hover:bg-hover focus-visible:shadow-ring-inset"
          onClick={onToggle}
        >
          {state === 'resolved' ? (
            <svg
              className="lo-i lo-i--sm flex-none text-success"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.25" />
              <path d="M5.5 8.25 7.25 10l3.25-3.75" />
            </svg>
          ) : (
            <CommentIcon />
          )}
          <span className="flex-none">{word}</span>
          <Avatar login={first.author} image={first.image} size="sm" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-fg">{first.author}</span>
            {excerpt !== undefined && ` ${excerpt}`}
          </span>
          {said !== undefined && <span className="lo-num flex-none">{said}</span>}
          <Chevron up={false} />
        </button>
      </div>
    );
  }

  const tone: TagTone = state === 'resolved' ? 'ok' : 'warning';
  const showReply = reply === undefined && canReply;
  return (
    <div
      role="group"
      aria-label={`${word} thread by ${first.author}`}
      data-thread-state={state}
      data-focused={focused ? '' : undefined}
      className={`${card({ view: 'open', ground })} ${className}`}
    >
      <div className="flex min-h-32 items-center gap-8 border-b border-border-subtle py-4 ps-12 pe-6 text-fg-muted text-small">
        {/* The tags and the count wrap in the room the buttons leave, which they never give up. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
          <Tag tone={tone}>{word}</Tag>
          {outdated && <Tag>Outdated</Tag>}
          {tags.map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
          <span className="whitespace-nowrap">
            {pendingAll ? 'Your review, not sent' : counted(comments)}
          </span>
        </span>
        <span className="flex flex-none items-center gap-2">
          {canResolve && !pendingAll && (
            <Button variant="ghost" size="sm" onClick={onResolve}>
              {resolved ? 'Unresolve' : 'Resolve'}
              {keys.resolve && <Key keys={keys.resolve} decorative />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Collapse the thread"
            aria-expanded
            {...withKeys('Collapse the thread', keys.toggle)}
            onClick={onToggle}
          >
            <Chevron up />
          </Button>
        </span>
      </div>
      {comments.map((comment, index) => (
        <div
          key={comment.id}
          data-comment={comment.id}
          className={`flex gap-8 px-12 py-8 ${index === 0 ? '' : 'border-t border-border-subtle'}`}
        >
          <Avatar login={comment.author} image={comment.image} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex min-h-24 flex-wrap items-center gap-x-8 gap-y-2 text-fg-muted text-small">
              <span className="font-semibold whitespace-nowrap text-fg">
                {comment.author}
                {comment.mine && <span className="font-normal text-fg-muted"> (you)</span>}
              </span>
              <span className="lo-num whitespace-nowrap">{comment.when}</span>
              {comment.byAuthor && <Tag>Author</Tag>}
              {comment.pending && !pendingAll && <Tag tone="warning">Pending</Tag>}
              {comment.mine && (
                <span className="ms-auto flex flex-none items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit your comment from ${comment.when}`}
                    onClick={() => onEdit?.(comment.id)}
                  >
                    Edit
                    {comment.id === newestMine && keys.edit && <Key keys={keys.edit} decorative />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete your comment from ${comment.when}`}
                    onClick={() => onDelete?.(comment.id)}
                  >
                    Delete
                    {comment.id === newestMine && keys.delete && (
                      <Key keys={keys.delete} decorative />
                    )}
                  </Button>
                </span>
              )}
            </div>
            <div className="lo-selectable mt-2 text-fg read-comment">{comment.body}</div>
          </div>
        </div>
      ))}
      {showReply && (
        <div className="border-t border-border-subtle py-8 ps-40 pe-12">
          <button
            type="button"
            className="flex h-control-h w-full items-center gap-8 rounded-sm border border-border bg-bg-well px-8 text-start text-fg-subtle text-ui hover:border-border-strong focus-visible:shadow-ring"
            onClick={onReply}
          >
            Reply…
            {keys.reply && (
              <span className="ms-auto">
                <Key keys={keys.reply} quiet decorative />
              </span>
            )}
          </button>
        </div>
      )}
      {reply !== undefined && (
        <div className="border-t border-border-subtle px-12 py-8">{reply}</div>
      )}
    </div>
  );
}
