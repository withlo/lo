import { cva } from 'class-variance-authority';
import { useRef, type ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { useGiveUp } from './giveUp.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Key, keyAria } from './Key.tsx';
import { MoreButton } from './MoreButton.tsx';
import { Spinner } from './Spinner.tsx';
import { Tag, type TagTone } from './Tag.tsx';
import { announceSlot, EDIT_SLOT } from './edits.ts';
import { Tooltip } from './Tooltip.tsx';

/** One comment of a thread, as its card shows it. */
export interface ThreadComment {
  /** What identifies it, as its element's `data-comment` names it to a right-click. */
  id: string;
  /** Who wrote it, by login. */
  author: string;
  /** The address of their picture. */
  image?: string | undefined;
  /** How long ago, as the card says it: "2 d ago". */
  when: string;
  /**
   * It's yours: it says so, and has its own `⋯`, whose menu edits or deletes it, where the thread
   * has a menu. No one else's does.
   */
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
   * The comments a box is editing, by their `id`s. The box is the comment meanwhile: the open card
   * draws a slot in each one's place, which the box moves into, so a comment's text shows once.
   */
  editing?: ReadonlySet<string> | undefined;
  /** You can reply to it. */
  canReply?: boolean | undefined;
  keys?: ThreadKeys | undefined;
  /**
   * A right-click on the card opens a menu where it's drawn, as in a code view: its head has the
   * `⋯` button that opens the same menu, and each of your comments has its own, which opens the
   * menu a right-click on that comment does, whose Edit and Delete act on it. It shows on the
   * comment under the pointer or with focus in it, and on the one the card's keys act on.
   */
  menu?: boolean | undefined;
  /** An open reply box, in place of the row that offers one. */
  reply?: ReactNode;
  /** The collapse or the line was clicked. */
  onToggle?: (() => void) | undefined;
  onResolve?: (() => void) | undefined;
  onReply?: (() => void) | undefined;
  /** More classes for the card, such as the space the code view leaves around it. */
  className?: string | undefined;
  /**
   * Where it's drawn: on a `card` of its own, under its line, or in a `popover` over the code, whose
   * shell is its ground: open, with no ground, ring or collapse of its own, its head one line that
   * gives up its key chips, Resolve's words and then its count as it narrows. In a popover,
   * `focused` is the popover pinned: its key chips and its Close show, in room a preview keeps for
   * them, so pinning it moves nothing.
   */
  variant?: 'card' | 'popover' | undefined;
  /** In a popover, what the thread is on, in its head: "Lines 10–35". */
  lines?: string | undefined;
  /** In a popover, its Close, at the head's end: the popover's, on its first thread. */
  onClose?: (() => void) | undefined;
  /** Close's keys, as this system shows them. */
  closeKeys?: readonly string[] | undefined;
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

/** An open thread card's frame, ringed while the keyboard is on it: an overview note's too. */
export function threadCard(focused: boolean): string {
  return card({ view: 'open', ground: focused ? 'focused' : 'rest' });
}

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
  return <Icon name={up ? 'chevron-up' : 'chevron-down'} size={16} />;
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

/**
 * What a popover's head gives up, in order, as it narrows, so it stays one line: the key chips,
 * Resolve's words for its icon, and then the count.
 */
const POP_STEPS = ['keys', 'labels', 'detail'];

/** The words of the control that closes a thread's popover, and its tooltip. */
export const CLOSE_THREAD = 'Close thread';

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
  /** Its author opened the pull request, which its card will say. */
  byAuthor?: boolean | undefined;
  /**
   * The thread's row that offers a reply comes under it, as it will under the comment in the card
   * that takes its place, for a new thread's comment and a reply. It takes nothing until then.
   */
  reply?: boolean | undefined;
  /**
   * Its text alone, as an edit's in a card whose own head says who wrote it and that it's being
   * saved: no head, no avatar and no room of its own around it.
   */
  bare?: boolean | undefined;
  /** The text as it will read, already drawn. */
  body: ReactNode;
}

/**
 * A comment the reader has sent that GitHub hasn't answered for yet, drawn as it will be on its
 * card, with "Sending…" where its time will be, under the head row of the thread it starts, if it
 * starts one, and over the row that offers a reply, where the card will have one. The comment box
 * draws it in its own place from the moment it's sent, so the text never leaves the screen; the
 * card takes its place when it arrives, with nothing moving.
 */
export function SentPost({
  state,
  author,
  image,
  label = 'Sending…',
  byAuthor = false,
  reply = false,
  bare = false,
  body,
}: SentPostProps) {
  if (bare) {
    return (
      <div data-sent="" className="lo-selectable text-fg read-comment">
        {body}
      </div>
    );
  }
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
          {byAuthor && <Tag>Author</Tag>}
        </div>
        <div className="lo-selectable mt-2 text-fg read-comment">{body}</div>
      </div>
    </div>
  );
  return (
    <>
      {state !== undefined && (
        <div className={HEAD_ROW}>
          <span className={HEAD_WORDS}>
            <Tag tone="warning">{state}</Tag>
            <span className="whitespace-nowrap">1 comment</span>
          </span>
        </div>
      )}
      {post}
      {reply && <ReplyRow />}
    </>
  );
}

interface ReplyRowProps {
  /** Its keys, as this system shows them: shown while it has focus. */
  keys?: readonly string[] | undefined;
  /** Pressed. Without it, the row only holds its place, as under a comment being sent: inert. */
  onReply?: (() => void) | undefined;
}

/**
 * The row at the foot of a thread's open card that offers a reply: a field-like button, "Reply",
 * which opens the reply's box in the row's place. Without `onReply` it's the same row, inert, as
 * under a comment on its way, whose card will have it.
 */
function ReplyRow({ keys, onReply }: ReplyRowProps) {
  const face =
    'flex h-control-h w-full items-center gap-8 rounded-sm border border-border bg-bg-well px-8 text-start text-fg-subtle text-ui';
  return (
    <div className="border-t border-border-subtle py-8 ps-40 pe-12">
      {onReply === undefined ? (
        <div inert aria-hidden="true" className={face}>
          Reply
        </div>
      ) : (
        // Its key: the field says "Reply" already.
        <Tooltip label={keys === undefined ? null : 'Reply'} keys={keys}>
          <button
            type="button"
            {...keyAria(keys, undefined)}
            className={`${face} hover:border-border-strong focus-visible:shadow-ring`}
            onClick={onReply}
          >
            Reply
            {keys && (
              <span className="ms-auto">
                <Key keys={keys} when="focus" quiet decorative />
              </span>
            )}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * A control's words, as Resolve's in a popover's head: its label, or, where its head has given up
 * labels (`give-up`), its icon alone, with the label as its tooltip.
 */
function Face({ icon, children }: { icon: IconName; children: string }) {
  return (
    <>
      <span data-takes="labels" className="inline-flex">
        <Icon name={icon} size={16} />
      </span>
      <span data-gives="labels">{children}</span>
    </>
  );
}

/**
 * What a comment's head gives up, in order, as its card narrows, so it stays one line with its
 * name whole for as long as it can: the "Author" tag, the words of a delete at work, which keeps
 * its spinner, and the time. Only then is the name cut short.
 */
const HEAD_STEPS = ['tag', 'labels', 'time'];

/** A comment's head: who wrote it and when, and the `⋯` of your own. */
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
 * A thread's head in a popover: one line, which stays over its comments as they scroll, and gives
 * up what `POP_STEPS` names as it narrows.
 */
function PopoverHead({ children }: { children: ReactNode }) {
  const head = useRef<HTMLDivElement | null>(null);
  useGiveUp(head, POP_STEPS);
  return (
    <div
      ref={head}
      data-pop-head=""
      className="give-up sticky top-0 z-1 flex h-32 items-center gap-8 border-b border-border-subtle bg-bg-overlay ps-12 pe-6 whitespace-nowrap text-fg-muted text-small"
    >
      {children}
    </div>
  );
}

/**
 * A review thread: its comments, its state and a way to reply, under its line in the diff or on an
 * overview's code block. Unresolved threads start open and resolved ones collapsed to one line.
 * A comment's text is a slot for what's already drawn; only your own comments have a `⋯` of their
 * own, whose menu edits or deletes them, and Resolve and Reply show only where GitHub lets you.
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
  className = '',
  variant = 'card',
  lines,
  onClose,
  closeKeys,
}: ThreadProps) {
  const [first] = comments;
  if (first === undefined) return null;
  // A thread you've begun in your review is only yours: there's nothing on GitHub to resolve yet.
  const pendingAll = comments.every((each) => each.pending);
  const state = pendingAll ? 'pending' : resolved ? 'resolved' : 'unresolved';
  const word = { pending: 'Pending', resolved: 'Resolved', unresolved: 'Unresolved' }[state];
  const newestMine = comments.findLast((each) => each.mine)?.id;
  const ground = focused ? 'focused' : 'rest';
  const popover = variant === 'popover';

  if (!open && !popover) {
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
                <Icon name="circle-check" size={12} className="text-success" />
              ) : (
                <Icon name="message-square" size={12} />
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
  const resolve = canResolve && !pendingAll && (
    <Button
      variant="ghost"
      size="sm"
      // In a popover's head it gives up its words for its icon as the head narrows.
      data-squares={popover ? 'labels' : undefined}
      aria-label={popover ? (resolved ? 'Unresolve' : 'Resolve') : undefined}
      // Asked already, it shows what was asked for: the word is the one being done.
      busy={resolving}
      working={
        popover ? (
          <span data-gives="labels">{resolved ? 'Resolving…' : 'Unresolving…'}</span>
        ) : resolved ? (
          'Resolving…'
        ) : (
          'Unresolving…'
        )
      }
      align="end"
      // One change to a thread at a time: while a delete is at work, it says so.
      disabled={deleting !== undefined}
      // Its name, with its key: in a card, where its words always show, only with a key to give.
      hint={
        deleting !== undefined
          ? 'Deleting…'
          : popover || keys.resolve !== undefined
            ? resolved
              ? 'Unresolve'
              : 'Resolve'
            : null
      }
      hintKeys={keys.resolve}
      onClick={onResolve}
    >
      {popover ? (
        <Face icon={resolved ? 'undo-2' : 'check'}>{resolved ? 'Unresolve' : 'Resolve'}</Face>
      ) : resolved ? (
        'Unresolve'
      ) : (
        'Resolve'
      )}
      {keys.resolve && <Key keys={keys.resolve} when="focus" decorative />}
    </Button>
  );
  const tagged = (
    <>
      <Tag tone={tone}>{word}</Tag>
      {outdated && <Tag>Out of date</Tag>}
      {tags.map((tag) => (
        <Tag key={tag.label} tone={tag.tone}>
          {tag.label}
        </Tag>
      ))}
    </>
  );
  return (
    <div
      role="group"
      aria-label={`${word} thread by ${first.author}`}
      data-thread-state={state}
      data-focused={focused ? '' : undefined}
      data-key-scope=""
      // In a popover, a preview keeps the room of the chips a pinned one shows.
      data-key-room={popover ? '' : undefined}
      className={
        popover ? `text-fg ${className}` : `${card({ view: 'open', ground })} ${className}`
      }
    >
      {popover ? (
        <PopoverHead>
          <span className="flex min-w-0 flex-1 items-center gap-8">
            {tagged}
            {lines !== undefined && (
              <span data-fit className="min-w-cut truncate">
                {lines}
              </span>
            )}
            <span data-gives="detail" className="lo-num flex-none">
              {counted(comments, pendingAll)}
            </span>
          </span>
          <span className="flex flex-none items-center gap-2">
            {resolve}
            {menu && <MoreButton />}
            {onClose && (
              // Only a pinned popover has it, in room a preview keeps, so pinning moves nothing.
              <span
                aria-hidden={focused ? undefined : true}
                className={focused ? 'flex move-swap' : 'invisible flex'}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={CLOSE_THREAD}
                  tabIndex={focused ? undefined : -1}
                  hint={CLOSE_THREAD}
                  hintKeys={closeKeys}
                  onClick={onClose}
                >
                  <Icon name="x" size={14} />
                </Button>
              </span>
            )}
          </span>
        </PopoverHead>
      ) : (
        <div className={HEAD_ROW}>
          {/* The tags and the count wrap in the room the buttons leave, which they never give up. */}
          <span className={HEAD_WORDS}>
            {tagged}
            {/* A thread only in your review says so once, in its tag: here it's counted as any is. */}
            <span className="whitespace-nowrap">{counted(comments, pendingAll)}</span>
          </span>
          <span className="flex flex-none items-center gap-2">
            {resolve}
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
      )}
      {comments.map((comment, index) =>
        editing?.has(comment.id) ? (
          <EditSlot key={comment.id} comment={comment.id} first={index === 0} />
        ) : (
          <div
            key={comment.id}
            data-comment={comment.id}
            // Your comment's `⋯` shows under the pointer, with focus in it, and, on a card the
            // keyboard is on, on the comment its keys act on, your newest.
            data-shy-scope={comment.mine && menu ? '' : undefined}
            data-focused={
              comment.mine && menu && focused && !popover && comment.id === newestMine
                ? ''
                : undefined
            }
            // In a popover, the ring `j` and `k` move goes round a comment, which `i` and `d d` act
            // on: it takes focus, though `Tab` passes it.
            tabIndex={popover ? -1 : undefined}
            className={`flex gap-8 px-12 py-8 ${index === 0 ? '' : 'border-t border-border-subtle'} ${popover ? 'scroll-my-8 outline-none focus-visible:shadow-ring-inset' : ''}`}
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
                {comment.mine &&
                  menu &&
                  (comment.id === deleting ? (
                    // A delete asked from its menu or by its key is at work, where its `⋯` was.
                    <span className="inline-flex flex-none items-center gap-6">
                      <Spinner />
                      <span data-gives="labels">Deleting…</span>
                    </span>
                  ) : (
                    // Named for its comment, as every comment's is the same button.
                    <MoreButton label={`More actions for comment from ${comment.when}`} shy />
                  ))}
              </Head>
              <div className="lo-selectable mt-2 text-fg read-comment">{comment.body}</div>
            </div>
          </div>
        ),
      )}
      {showReply && <ReplyRow keys={keys.reply} onReply={onReply ?? (() => {})} />}
      {reply !== undefined && (
        <div className="border-t border-border-subtle px-12 py-8">{reply}</div>
      )}
    </div>
  );
}

/**
 * The place in the card of `comment`, which a box is editing: the code view moves the box into it
 * as it's drawn, so the box opens where the comment was and its text shows once. Empty, as where
 * nothing moves a box in, it takes no room.
 */
function EditSlot({ comment, first }: { comment: string; first: boolean }) {
  return (
    <div
      ref={announceSlot}
      {...{ [EDIT_SLOT]: comment }}
      className={`px-12 py-8 empty:hidden ${first ? '' : 'border-t border-border-subtle'}`}
    />
  );
}
