import { cva } from 'class-variance-authority';
import { useRef, type ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { useGiveUp } from './giveUp.ts';
import { Key, keyAria } from './Key.tsx';
import { MoreButton } from './MoreButton.tsx';
import { Spinner } from './Spinner.tsx';
import { Tag, type TagTone } from './Tag.tsx';
import { CommentIcon } from './ThreadCount.tsx';
import { Tooltip } from './Tooltip.tsx';

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

/** A short label beside a thread's state, such as "On r5". */
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
  /** Others beside its state: "On r5". */
  tags?: readonly ThreadTag[] | undefined;
  /** The first comment's opening, as plain text, for the collapsed line. */
  excerpt?: string | undefined;
  /** The keyboard is on it: `]t` landed here. */
  focused?: boolean | undefined;
  /** You can resolve it, or unresolve it once it's resolved. */
  canResolve?: boolean | undefined;
  /**
   * Resolve or Unresolve was asked and GitHub hasn't answered: `resolved` is already what was asked
   * for, and the control says it's working.
   */
  resolving?: boolean | undefined;
  /** The comment of yours whose delete was asked and GitHub hasn't answered for, by its `id`. */
  deleting?: string | undefined;
  /**
   * The comments a box under the card is editing, by their `id`s. The box is the comment meanwhile,
   * so the open card draws without them: a comment's text shows once.
   */
  editing?: ReadonlySet<string> | undefined;
  /** You can reply to it. */
  canReply?: boolean | undefined;
  keys?: ThreadKeys | undefined;
  /**
   * A right-click on the card opens a menu where it's drawn, as in a code view: its head has the
   * `⋯` button that opens the same menu.
   */
  menu?: boolean | undefined;
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
function counted(comments: readonly ThreadComment[], pendingAll: boolean): string {
  const pending = comments.filter((each) => each.pending).length;
  const all = `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}`;
  return pending > 0 && !pendingAll ? `${all}, ${pending} pending` : all;
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

/**
 * An open card's head row: its state, its count and its controls. A sent comment's card draws the
 * same row as the thread it starts will have (`SentPost`'s `state`), so its text stays where it is
 * as the thread takes its place.
 */
const HEAD_ROW =
  'flex min-h-32 items-center gap-8 border-b border-border-subtle py-4 ps-12 pe-6 text-fg-muted text-small';

/** Where an open card's head row holds its tags and its count: they wrap in the room left them. */
const HEAD_WORDS = 'flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4';

export interface SentPostProps {
  /**
   * The state of the thread it starts, for a new thread's comment: "Unresolved", or "Pending" for
   * one added to a review. Its card then has the head row that thread's will, so nothing moves as
   * the thread takes the card's place. A reply's or an edit's has none.
   */
  state?: 'Unresolved' | 'Pending' | undefined;
  /** Who it's from: the account that wrote it, where that's known. */
  author?: string | undefined;
  image?: string | undefined;
  /** What's being done with it, where its time will be: "Sending…", or "Saving…" for an edit. */
  label?: string | undefined;
  /** The text as it will read, already drawn. */
  body: ReactNode;
}

/**
 * A comment the reader has sent that GitHub hasn't answered for yet, drawn as it will be on its
 * card, with "Sending…" where its time will be, under the head row of the thread it starts, if it
 * starts one. The comment box draws it in its own place from the
 * moment it's sent, so the text never leaves the screen; the card takes its place when it arrives.
 */
export function SentPost({ state, author, image, label = 'Sending…', body }: SentPostProps) {
  const post = (
    // Whoever sends it says so to a screen reader: drawn with its words, this would say nothing.
    <div data-sent="" className="flex gap-8 px-12 py-8">
      {author !== undefined && <Avatar login={author} image={image} size="sm" />}
      <div className="min-w-0 flex-1">
        <div className="flex min-h-24 flex-wrap items-center gap-x-8 gap-y-2 text-fg-muted text-small">
          {author !== undefined && (
            <span className="font-semibold whitespace-nowrap text-fg">
              {author}
              <span className="font-normal text-fg-muted"> (you)</span>
            </span>
          )}
          <span className="inline-flex items-center gap-6 whitespace-nowrap">
            <Spinner />
            {label}
          </span>
        </div>
        <div className="lo-selectable mt-2 text-fg read-comment">{body}</div>
      </div>
    </div>
  );
  if (state === undefined) return post;
  return (
    <>
      <div className={HEAD_ROW}>
        <span className={HEAD_WORDS}>
          <Tag tone="warning">{state}</Tag>
          <span className="whitespace-nowrap">1 comment</span>
        </span>
      </div>
      {post}
    </>
  );
}

function EditIcon() {
  return (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.25 3.25 12.75 5.75M3 13l.6-2.9 7.15-7.15a1.06 1.06 0 0 1 1.5 0l1 1a1.06 1.06 0 0 1 0 1.5L6.1 12.4 3 13Z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V4.5M4.5 4.5l.5 8a1 1 0 0 0 1 .95h4a1 1 0 0 0 1-.95l.5-8" />
    </svg>
  );
}

/**
 * A comment's own control, Edit or Delete…: its label, or, where its head has given up labels
 * (`give-up`), its icon alone, with the label as its tooltip.
 */
function Face({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <>
      <span data-takes="labels" className="inline-flex">
        {icon}
      </span>
      <span data-gives="labels">{children}</span>
    </>
  );
}

/**
 * What a comment's head gives up, in order, as its card narrows, so it stays one line with its
 * name whole for as long as it can: the key chips, the "Author" tag, Edit's and Delete…'s words
 * for their icons, and the time. Only then is the name cut short.
 */
const HEAD_STEPS = ['keys', 'tag', 'labels', 'time'];

/** A comment's head: who wrote it and when, and the controls you have on your own. */
function Head({ children }: { children: ReactNode }) {
  const head = useRef<HTMLDivElement | null>(null);
  useGiveUp(head, HEAD_STEPS);
  return (
    <div
      ref={head}
      className="give-up flex min-h-24 items-center gap-8 whitespace-nowrap text-fg-muted text-small"
    >
      {children}
    </div>
  );
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
  resolving = false,
  deleting,
  editing,
  keys = {},
  menu = false,
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
    const working = resolving
      ? resolved
        ? 'Resolving…'
        : 'Unresolving…'
      : deleting !== undefined
        ? 'Deleting…'
        : undefined;
    return (
      <div
        role="group"
        aria-label={`${word} thread by ${first.author}`}
        data-thread-state={state}
        data-focused={focused ? '' : undefined}
        className={`${card({ view: 'collapsed', ground })} ${className}`}
      >
        {/* The line opens the thread wherever it's clicked; `⋯` alone is a control of its own. */}
        <div className="flex h-32 items-center gap-2 pe-6 text-fg-muted text-small hover:bg-hover">
          <Tooltip label="Expand thread" keys={keys.toggle}>
            <button
              type="button"
              aria-expanded={false}
              {...keyAria(keys.toggle, undefined)}
              className="flex h-full min-w-0 flex-1 items-center gap-8 ps-12 pe-6 text-start focus-visible:shadow-ring-inset"
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
              {working !== undefined ? (
                // A change asked from its menu or by its key is at work, as its open card's control says.
                <span className="inline-flex flex-none items-center gap-6">
                  <Spinner />
                  {working}
                </span>
              ) : (
                said !== undefined && <span className="lo-num flex-none">{said}</span>
              )}
            </button>
          </Tooltip>
          {menu && <MoreButton />}
          <Button
            variant="ghost"
            size="sm"
            icon
            // The line is the control a key or a screen reader opens it by.
            tabIndex={-1}
            aria-hidden="true"
            onClick={onToggle}
          >
            <Chevron up={false} />
          </Button>
        </div>
      </div>
    );
  }

  const tone: TagTone = state === 'resolved' ? 'ok' : 'warning';
  const showReply = reply === undefined && canReply;
  const drawn = editing ? comments.filter((each) => !editing.has(each.id)) : comments;
  return (
    <div
      role="group"
      aria-label={`${word} thread by ${first.author}`}
      data-thread-state={state}
      data-focused={focused ? '' : undefined}
      data-key-scope=""
      className={`${card({ view: 'open', ground })} ${className}`}
    >
      <div className={HEAD_ROW}>
        {/* The tags and the count wrap in the room the buttons leave, which they never give up. */}
        <span className={HEAD_WORDS}>
          <Tag tone={tone}>{word}</Tag>
          {outdated && <Tag>Out of date</Tag>}
          {tags.map((tag) => (
            <Tag key={tag.label} tone={tag.tone}>
              {tag.label}
            </Tag>
          ))}
          {/* A thread only in your review says so once, in its tag: here it's counted as any is. */}
          <span className="whitespace-nowrap">{counted(comments, pendingAll)}</span>
        </span>
        <span className="flex flex-none items-center gap-2">
          {canResolve && !pendingAll && (
            <Button
              variant="ghost"
              size="sm"
              // Asked already, it shows what was asked for: the word is the one being done.
              busy={resolving}
              working={resolved ? 'Resolving…' : 'Unresolving…'}
              align="end"
              // One change to a thread at a time: while a delete is at work, it says so.
              disabled={deleting !== undefined}
              hint={deleting !== undefined ? 'Deleting…' : resolved ? 'Unresolve' : 'Resolve'}
              hintKeys={keys.resolve}
              onClick={onResolve}
            >
              {resolved ? 'Unresolve' : 'Resolve'}
              {keys.resolve && <Key keys={keys.resolve} when="focus" decorative />}
            </Button>
          )}
          {menu && <MoreButton />}
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Collapse thread"
            aria-expanded
            hint="Collapse thread"
            hintKeys={keys.toggle}
            onClick={onToggle}
          >
            <Chevron up />
          </Button>
        </span>
      </div>
      {drawn.map((comment, index) => (
        <div
          key={comment.id}
          data-comment={comment.id}
          className={`flex gap-8 px-12 py-8 ${index === 0 ? '' : 'border-t border-border-subtle'}`}
        >
          <Avatar login={comment.author} image={comment.image} size="sm" />
          <div className="min-w-0 flex-1">
            <Head>
              <span className="flex min-w-0 flex-1 items-center gap-8">
                <span data-fit className="min-w-0 truncate font-semibold text-fg">
                  {comment.author}
                  {comment.mine && <span className="font-normal text-fg-muted"> (you)</span>}
                </span>
                <span data-gives="time" className="lo-num flex-none">
                  {comment.when}
                </span>
                {comment.byAuthor && (
                  <span data-gives="tag" className="inline-flex flex-none">
                    <Tag>Author</Tag>
                  </span>
                )}
                {comment.pending && !pendingAll && <Tag tone="warning">Pending</Tag>}
              </span>
              {comment.mine && (
                <span className="flex flex-none items-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-squares="labels"
                    // Named for its comment, as every comment's is the same button.
                    aria-label={`Edit comment from ${comment.when}`}
                    hint="Edit"
                    hintKeys={comment.id === newestMine ? keys.edit : undefined}
                    onClick={() => onEdit?.(comment.id)}
                  >
                    <Face icon={<EditIcon />}>Edit</Face>
                    {comment.id === newestMine && keys.edit && (
                      <Key keys={keys.edit} when="focus" decorative />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-squares="labels"
                    aria-label={`Delete comment from ${comment.when}…`}
                    busy={comment.id === deleting}
                    working={<span data-gives="labels">Deleting…</span>}
                    align="end"
                    // One change to a thread at a time: while a resolve is at work, it says so.
                    disabled={resolving}
                    hint={resolving ? (resolved ? 'Resolving…' : 'Unresolving…') : 'Delete…'}
                    hintKeys={comment.id === newestMine ? keys.delete : undefined}
                    onClick={() => onDelete?.(comment.id)}
                  >
                    <Face icon={<DeleteIcon />}>Delete…</Face>
                    {comment.id === newestMine && keys.delete && (
                      <Key keys={keys.delete} when="focus" decorative />
                    )}
                  </Button>
                </span>
              )}
            </Head>
            <div className="lo-selectable mt-2 text-fg read-comment">{comment.body}</div>
          </div>
        </div>
      ))}
      {showReply && (
        <div className="border-t border-border-subtle py-8 ps-40 pe-12">
          <Tooltip label="Reply" keys={keys.reply}>
            <button
              type="button"
              {...keyAria(keys.reply, undefined)}
              className="flex h-control-h w-full items-center gap-8 rounded-sm border border-border bg-bg-well px-8 text-start text-fg-subtle text-ui hover:border-border-strong focus-visible:shadow-ring"
              onClick={onReply}
            >
              Reply
              {keys.reply && (
                <span className="ms-auto">
                  <Key keys={keys.reply} when="focus" quiet decorative />
                </span>
              )}
            </button>
          </Tooltip>
        </div>
      )}
      {reply !== undefined && (
        <div className="border-t border-border-subtle px-12 py-8">{reply}</div>
      )}
    </div>
  );
}
