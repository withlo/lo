// Files attached to a comment box: dropped on it, pasted into it, or picked with "Attach" (`⌘⇧A`),
// ten on their way into a box at most. Each goes in at the cursor at once as a placeholder, is
// checked and has its metadata taken out in the background process (`comments.prepare`), from the
// bytes of the window's own `File`, and main uploads it to the pull request's repository, one at a
// time, saying how far it has gone. Once it's uploaded, the placeholder becomes the Markdown that
// shows it, or, where the placeholder went meanwhile, its row offers to insert it; refused, failed
// or cancelled, it goes. The box lists each file meanwhile, warns that uploads stay reachable, and
// says what Lo took out of each, or that it couldn't, and why it didn't attach one. Each
// placeholder's address holds a token made for its upload alone, so only one Lo wrote is taken for
// a placeholder: its comment isn't sent while one uploads, nor while its text holds a placeholder
// whose upload isn't under way, as after Lo restarts; it says which, and the reader takes it out.
// Main says once a view whether its account can write to the repository, which uploads need,
// without holding up anything else. Where it can't, or GitHub takes no uploads with Lo's sign-in
// and gh has none, "Attach" is off in the view's boxes, nothing dropped goes in, and an image's
// `https` address pasted or dropped goes in as an image; files dropped before it said go in, and
// out again before they're sent. Nothing is uploaded again by itself.

import type { Metadata } from '@lo/github';
import type { Composer } from '@lo/ui/code';

import { clockOf } from '../../../window/time.ts';
import { pullOf, runOf } from '../../tab/window/shared.ts';
import {
  ATTACHMENT_LIMIT,
  type UploadOutcome,
  type UploadProgressRow,
  type UploadRefusal,
} from '../contract.ts';
import type { Prepared } from '../jobs.ts';
import { commentsJobs, main } from './main.ts';
import type { BoxNote } from './writing.ts';

/** The most files a box attaches at once. */
export const FILES_AT_ONCE = 10;

/** What the box says while files are in it. */
export const WARNING =
  'Uploads go to GitHub and stay reachable by link, even if you delete the comment.';

/** Why a box's comment isn't sent while a file uploads. */
export const UPLOADING = 'Uploading. Send the comment once the files are in.';

/** What uploads use of a comment box. */
export interface Attachable {
  /** Its own name, which ties its foot to its notes. */
  readonly id: string;
  /** The view it's in, whose account and pull request it writes as and on. */
  readonly view: string;
  /** The editor the diff draws, while it does. */
  readonly composer: Composer | undefined;
  readonly state: { readonly text: string };
  /** Puts `text` in as its whole text while it isn't drawn, as when a placeholder changes. */
  rewrite(text: string): void;
}

/** A file in a box, as its row shows it. */
export interface UploadRow {
  /** The window's name for its upload. */
  readonly key: string;
  readonly name: string;
  /** As people read sizes: "212 KB". */
  readonly size: string;
  /** How far it has gone, from 0 to 1, once main says. */
  readonly progress: number | undefined;
  readonly uploaded: boolean;
  /** Uploaded, but its placeholder had gone from the text, so its Markdown isn't in it. */
  readonly unplaced: boolean;
}

/** What a box shows of the files attached to it. */
export interface AttachState {
  readonly rows: readonly UploadRow[];
  /** What it says of them, in order. */
  readonly notes: readonly BoxNote[];
  /** How many files are being dragged over it. */
  readonly dropping: number;
}

/**
 * Why a view's boxes take no uploads, once an upload found out: the account can't write to the
 * repository `repo`, or GitHub takes none with Lo's sign-in and gh has none for the account.
 */
export type UploadsOff = { kind: 'cantWrite'; repo: string } | { kind: 'needsGh' };

/** A file being attached, until it's uploaded, refused, failed or cancelled. */
interface Attachment {
  readonly key: string;
  readonly name: string;
  readonly size: string;
  /** Its placeholder's token, made for it alone. */
  readonly token: string;
  /** What stands in its place in the text until it's uploaded. */
  readonly placeholder: string;
  progress: number | undefined;
  stage: 'preparing' | 'uploading' | 'uploaded';
  cancelled: boolean;
  /** The Markdown that shows it, once it's uploaded. */
  markdown: string | undefined;
  /** Uploaded, but its placeholder had gone, so its Markdown isn't in the text. */
  unplaced: boolean;
  /** What the box says of it, while it's in the box: what Lo took out, and how it went. */
  notes: BoxNote[];
}

/** The files attached to one box, and what it says of them. */
class Attaching {
  readonly box: Attachable;
  readonly files: Attachment[] = [];
  /** What the box says of the files it didn't attach, until more are attached. */
  said: BoxNote[] = [];
  dropping = 0;
  #state: AttachState = { rows: [], notes: [], dropping: 0 };
  readonly #listeners = new Set<() => void>();

  constructor(box: Attachable) {
    this.box = box;
  }

  get state(): AttachState {
    return this.#state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** What it shows has changed: tells whoever draws it. */
  changed(): void {
    this.#state = {
      rows: this.files.map(({ key, name, size, progress, stage, unplaced }) => ({
        key,
        name,
        size,
        progress: stage === 'uploading' ? progress : undefined,
        uploaded: stage === 'uploaded',
        unplaced,
      })),
      notes: [
        ...(this.files.length > 0
          ? [{ key: 'upload-warning', tone: 'warning' as const, text: WARNING }]
          : []),
        ...this.files.flatMap((file) => file.notes),
        ...this.said,
      ],
      dropping: this.dropping,
    };
    for (const listener of this.#listeners) listener();
  }

  /** Says `text` of the files it didn't attach. */
  say(key: string, text: string, tone: 'info' | 'warning' = 'warning'): void {
    this.said = [...this.said, { key, tone, text }];
    this.changed();
  }

  /** The files still on their way in. */
  get running(): Attachment[] {
    return this.files.filter((file) => file.stage !== 'uploaded' && !file.cancelled);
  }

  /** Takes `file` out of the box, and its placeholder out of the text. */
  remove(file: Attachment): void {
    const at = this.files.indexOf(file);
    if (at !== -1) this.files.splice(at, 1);
    edit(this.box, (text) => withoutPlaceholder(text, file.placeholder));
    this.changed();
  }
}

const attachings = new WeakMap<Attachable, Attaching>();

/** Each upload under way, by the window's name for it, as main says how far it has gone. */
const underway = new Map<string, { attaching: Attaching; file: Attachment }>();

/** Each view whose boxes take no uploads, why, and for which account. */
const offViews = new Map<string, { login: string; off: UploadsOff }>();
const offListeners = new Set<() => void>();

/**
 * What main said of whether each view's account can upload, by view and login: asked once, and
 * again only when main couldn't tell.
 */
const checks = new Map<string, { view: string; done: boolean; asked: Promise<void> }>();

/** The files attached to `box`, and what it says of them. */
export function attachingOf(box: Attachable): Attaching {
  let attaching = attachings.get(box);
  if (!attaching) {
    attaching = new Attaching(box);
    attachings.set(box, attaching);
  }
  return attaching;
}

/**
 * Why `box`'s text isn't sent yet for the files attached to it: `running`, while one is on its way
 * in; `stranded`, while `text`, its text, holds a placeholder, whole or partly edited, whose upload
 * isn't under way, as after Lo restarts or the placeholder changed, with what the box says of it.
 */
export type UploadsHold = { kind: 'running' } | { kind: 'stranded'; text: string };

/** Why `box`'s text isn't sent yet for its files, if it isn't. */
export function uploadsHold(
  box: Attachable,
  text = box.composer?.text ?? box.state.text,
): UploadsHold | undefined {
  const attaching = attachings.get(box);
  if ((attaching?.running.length ?? 0) > 0) return { kind: 'running' };
  const found = strandedIn(attaching, text);
  return found.size === 0 ? undefined : { kind: 'stranded', text: strandedText(attaching, found) };
}

/** What a box says of `hold`, why it isn't sent: `uploading` while a file is on its way in. */
export function holdText(hold: UploadsHold | undefined, uploading: string): string | undefined {
  if (hold === undefined) return undefined;
  return hold.kind === 'running' ? uploading : hold.text;
}

/**
 * What marks a placeholder Lo wrote, whole or partly edited: its address, which holds a token made
 * for its upload alone, 64 random bits that nothing typed or pasted holds by chance.
 */
const TOKEN = /lo-upload:([0-9a-f]{16})(?![0-9a-z])/g;

/** A placeholder's alt text and address, with its file's name, as the alt escapes it, and token. */
const NAMED = /\[Uploading ((?:\\[^\n]|[^\]\\\n]){1,300})…\]\(lo-upload:([0-9a-f]{16})/g;

/** A new token for an upload's placeholder. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The placeholders in `text`, whole or partly edited, whose uploads aren't under way in `attaching`:
 * each by its token, with its file's name where its alt text still says it.
 */
function strandedIn(
  attaching: Attaching | undefined,
  text: string,
): Map<string, string | undefined> {
  const under = new Set(attaching?.running.map((file) => file.token));
  const named = new Map<string, string>();
  for (const [, name, token] of text.matchAll(NAMED)) {
    if (name !== undefined && token !== undefined) named.set(token, name.replace(/\\(.)/g, '$1'));
  }
  const found = new Map<string, string | undefined>();
  for (const [, token] of text.matchAll(TOKEN)) {
    if (token !== undefined && !under.has(token)) found.set(token, named.get(token));
  }
  return found;
}

/** What a box says of the placeholders `found` in its text, whose uploads aren't under way. */
function strandedText(
  attaching: Attaching | undefined,
  found: ReadonlyMap<string, string | undefined>,
): string {
  const unplaced = new Map(
    (attaching?.files ?? [])
      .filter((file) => file.unplaced)
      .map((file) => [file.token, file.name] as const),
  );
  const changed = new Set<string>();
  const lost = new Set<string>();
  let unnamed = false;
  for (const [token, name] of found) {
    const mine = unplaced.get(token);
    if (mine !== undefined) changed.add(mine);
    else if (name === undefined) unnamed = true;
    else lost.add(name);
  }
  const said: string[] = [];
  if (lost.size > 0) {
    const one = lost.size === 1;
    said.push(
      `${listed([...lost])} didn’t finish uploading. Attach ${one ? 'it' : 'them'} again, and take out ${one ? 'its placeholder' : 'their placeholders'}.`,
    );
  }
  if (changed.size > 0) {
    const one = changed.size === 1;
    said.push(
      `Lo didn’t put ${listed([...changed])} in, as ${one ? 'its placeholder' : 'their placeholders'} changed. Take ${one ? 'it' : 'them'} out, and “Insert” puts ${one ? 'the file' : 'each'} at the cursor.`,
    );
  }
  if (unnamed) said.push('Take out what’s left of an upload’s placeholder.');
  return said.join(' ');
}

/** The login view `view` writes as, if it writes as anyone. */
function loginOf(view: string): string | undefined {
  const acting = pullOf(view)?.acting;
  return acting?.kind === 'account' ? acting.login : undefined;
}

/** Why view `view`'s boxes take no uploads, for the account it acts as now, if they don't. */
export function uploadsOff(view: string): UploadsOff | undefined {
  const off = offViews.get(view);
  return off !== undefined && off.login === loginOf(view) ? off.off : undefined;
}

export function onUploadsOff(listener: () => void): () => void {
  offListeners.add(listener);
  return () => {
    offListeners.delete(listener);
  };
}

function setOff(view: string, login: string, off: UploadsOff): void {
  offViews.set(view, { login, off });
  for (const listener of offListeners) listener();
}

/**
 * Asks main once whether view `view`'s account can upload to its repository, so a view where it
 * can't takes no file. Answers what to wait for while it's asked, or nothing once it's known, or
 * where there's nothing to ask.
 */
export function checkUploads(view: string): Promise<void> | undefined {
  const login = loginOf(view);
  if (login === undefined || runOf(view)) return undefined;
  const key = `${view}\n${login}`;
  const known = checks.get(key);
  if (known) return known.done ? undefined : known.asked;
  const check = { view, done: false, asked: Promise.resolve() };
  check.asked = main()
    .attachable({ id: view })
    .then(
      (answer) => {
        // Main couldn't tell: it's asked again next time.
        if (answer.kind === 'unknown') {
          if (checks.get(key) === check) checks.delete(key);
          return;
        }
        check.done = true;
        if (answer.kind === 'cantWrite' && answer.login === login) {
          setOff(view, login, { kind: 'cantWrite', repo: answer.repo });
        }
      },
      (error: unknown) => {
        if (checks.get(key) === check) checks.delete(key);
        console.error("Lo couldn't ask whether uploads go:", error);
      },
    );
  checks.set(key, check);
  return check.asked;
}

/** Forgets what it knew of views other than those in `kept`, as their tabs close. */
export function keepUploadsOf(kept: ReadonlySet<string>): void {
  for (const view of offViews.keys()) if (!kept.has(view)) offViews.delete(view);
  for (const [key, { view }] of checks) if (!kept.has(view)) checks.delete(key);
}

/** What a box says while its view's boxes take no uploads. */
export function offNote(off: UploadsOff): BoxNote {
  const text =
    off.kind === 'cantWrite'
      ? `GitHub takes uploads only from people who can write to ${off.repo}. Paste an image’s web address instead.`
      : 'Uploads here need gh’s sign-in, since GitHub takes none with Lo’s. Paste an image’s web address instead.';
  return { key: 'uploads-off', tone: 'info', text };
}

/** Why view `view`'s boxes can't attach files now, if they can't. */
export function whyNoAttach(view: string): string | undefined {
  const pull = pullOf(view);
  if (pull?.acting?.kind !== 'account') return 'Sign in to attach files.';
  if (runOf(view)) return 'Comment in a layer';
  const off = uploadsOff(view);
  if (off !== undefined) return offNote(off).text;
  if (pull.connection.kind === 'offline') return 'Offline. Attach files once Lo can reach GitHub.';
  return undefined;
}

/** `bytes` as people read sizes, in units of 1,024: "212 KB", "3.4 MB". */
export function sizeText(bytes: number): string {
  const KIB = 1024;
  if (bytes < KIB) return `${bytes} bytes`;
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(0)} KB`;
  const megabytes = bytes / (KIB * KIB);
  const whole = megabytes - Math.trunc(megabytes) < 0.05 || megabytes >= 10;
  return `${megabytes.toFixed(whole ? 0 : 1)} MB`;
}

/**
 * Whether a file's name is of a kind GitHub takes, so it gets a placeholder at once. The
 * background process decides, from its bytes as well.
 */
export function looksAttachable(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i.test(name);
}

/** An image's alt text from its file's name, as GitHub's uploader writes it. */
export function altOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const alt = stem
    .replace(/[.\r\n]/g, ' ')
    .replace(/[\\[\]]/g, '\\$&')
    .trim();
  return alt === '' ? 'image' : alt;
}

/**
 * What stands in for file `name` in the text until it's uploaded, with `token`, made for its upload
 * alone: `![Uploading retry-storm.gif…](lo-upload:9f86d081884c7d65)`. Only Lo writes one, so only a
 * placeholder holds a comment back.
 */
export function placeholderFor(name: string, token: string): string {
  const shown = name.replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');
  return `![Uploading ${shown}…](lo-upload:${token})`;
}

/** A change to a box's text: what goes in place of the text from `from` to `to`. */
interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** `text` with `placeholder` in it taken out, with the line break that set it apart. */
export function withoutPlaceholder(text: string, placeholder: string): TextChange | undefined {
  const from = text.indexOf(placeholder);
  if (from === -1) return undefined;
  const to = from + placeholder.length;
  if (text[to] === '\n') return { from, to: to + 1, insert: '' };
  if (from > 0 && text[from - 1] === '\n') return { from: from - 1, to, insert: '' };
  return { from, to, insert: '' };
}

/** `text` with `placeholder` in it replaced by `markdown`. */
export function inPlaceOf(
  text: string,
  placeholder: string,
  markdown: string,
): TextChange | undefined {
  const from = text.indexOf(placeholder);
  return from === -1 ? undefined : { from, to: from + placeholder.length, insert: markdown };
}

/**
 * Changes `box`'s text as `change` works out from it: in its editor, or else in its draft. Says
 * whether there was anything to change.
 */
function edit(box: Attachable, change: (text: string) => TextChange | undefined): boolean {
  const { composer } = box;
  const text = composer?.text ?? box.state.text;
  const made = change(text);
  if (!made) return false;
  if (composer) composer.replace(made.from, made.to, made.insert);
  else box.rewrite(text.slice(0, made.from) + made.insert + text.slice(made.to));
  return true;
}

/** "a", "a and b", "a, b and c". */
function listed(what: readonly string[]): string {
  const last = what.at(-1) ?? '';
  const rest = what.slice(0, -1);
  return rest.length === 0 ? last : `${rest.join(', ')} and ${last}`;
}

/**
 * What the box says Lo took out of file `name` before uploading it, or that it couldn't, if there's
 * anything to say.
 */
export function metadataNote(name: string, metadata: Metadata): string | undefined {
  switch (metadata.kind) {
    case 'asIs':
      return `Lo couldn’t remove metadata from ${name}, so it uploads as it is.`;
    case 'image': {
      const { location, other, embedded } = metadata.removed;
      const what: string[] = [];
      if (location) what.push(`where ${name} was taken`);
      if (other) what.push(location ? 'its other metadata' : `${name}’s metadata`);
      if (embedded)
        what.push(what.length > 0 ? 'an image stored inside it' : `an image stored inside ${name}`);
      return what.length === 0 ? undefined : `Lo removed ${listed(what)} before uploading it.`;
    }
    case 'video': {
      const { location, other } = metadata.removed;
      const stays = 'The rest of its metadata stays, such as when it was filmed and on what.';
      const what: string[] = [];
      if (location) what.push(`where ${name} was filmed`);
      if (other) what.push(location ? 'its XMP metadata' : `${name}’s XMP metadata`);
      return what.length === 0
        ? `Lo found no location in ${name}. ${stays}`
        : `Lo removed ${listed(what)} before uploading it. ${stays}`;
    }
    default:
      metadata satisfies never;
      return undefined;
  }
}

/** What the box says of file `name`, which main didn't upload, refused before anything was sent. */
export function refusedText(name: string, refusal: UploadRefusal): string {
  switch (refusal.kind) {
    case 'file':
      return `Lo didn’t attach ${name}: ${refusal.why}.`;
    case 'cantWrite':
    case 'needsGh':
      return offNote(refusal).text;
    case 'paused':
      return `Lo didn’t attach ${name}: GitHub asked Lo to hold off until ${clockOf(refusal.until)}. Attach it again then.`;
    case 'signIn':
      return 'Sign in to attach files.';
    case 'run':
      return 'Comment in a layer';
    default:
      refusal satisfies never;
      return `Lo didn’t attach ${name}.`;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let made = 0;

/** A new name for an upload, unique in this window. */
function uploadKey(): string {
  made += 1;
  return `upload-${Date.now().toString(36)}-${made}`;
}

/** Whether `file` may be attached, by its name and size alone. */
function takes(file: File): boolean {
  return looksAttachable(file.name) && file.size <= ATTACHMENT_LIMIT;
}

/**
 * Attaches `files`, dropped on `box`, pasted into it or picked: each a placeholder at the cursor at
 * once, while no more than ten are on their way into the box, then prepared and uploaded in turn.
 * Where main hasn't said yet whether the account can upload, they go in all the same; where it
 * then says it can't, they go before they're sent, and the box says why.
 */
export function attachFiles(box: Attachable, files: readonly File[]): void {
  void checkUploads(box.view);
  const attaching = attachingOf(box);
  // What the box said of the files it didn't attach last time goes, as more come.
  attaching.said = [];
  const why = whyNoAttach(box.view);
  if (why !== undefined) {
    if (uploadsOff(box.view) === undefined) attaching.say('upload-why', why);
    else attaching.changed();
    return;
  }
  // Refused by name or size alone: nothing of them is read.
  const refused = files.filter((file) => !takes(file)).slice(0, FILES_AT_ONCE);
  const attachable = files.filter(takes);
  const room = Math.max(0, FILES_AT_ONCE - attaching.running.length);
  const taken = attachable.slice(0, room);
  if (attachable.length > room) {
    const rest = attachable.length - room;
    attaching.say(
      'upload-many',
      `Lo attaches ${FILES_AT_ONCE} files at a time, so it left out ${rest} ${rest === 1 ? 'file' : 'files'}.`,
    );
  }
  const coming: { file: File; attachment: Attachment }[] = [];
  for (const file of taken) {
    const token = newToken();
    const attachment: Attachment = {
      key: uploadKey(),
      name: file.name,
      size: sizeText(file.size),
      token,
      placeholder: placeholderFor(file.name, token),
      progress: undefined,
      stage: 'preparing',
      cancelled: false,
      markdown: undefined,
      unplaced: false,
      notes: [],
    };
    coming.push({ file, attachment });
  }
  if (coming.length > 0) {
    attaching.files.push(...coming.map(({ attachment }) => attachment));
    box.composer?.insert(coming.map(({ attachment }) => attachment.placeholder).join('\n'));
  }
  attaching.changed();
  void (async () => {
    for (const file of refused) await refuseUnread(attaching, file);
    for (const { file, attachment } of coming) await attachOne(attaching, file, attachment);
  })();
}

/** Says why `file` wasn't attached, from its name and size alone. */
async function refuseUnread(attaching: Attaching, file: File): Promise<void> {
  let why: string;
  try {
    const answer = await commentsJobs().prepare({ name: file.name, bytes: null });
    why = answer.kind === 'refused' ? answer.why : 'GitHub doesn’t take it';
  } catch (error) {
    why = describe(error);
  }
  attaching.say(`upload-refused-${uploadKey()}`, `Lo didn’t attach ${file.name}: ${why}.`);
}

/** Prepares `file` in the background process, then uploads it through main. */
async function attachOne(attaching: Attaching, file: File, attachment: Attachment): Promise<void> {
  const { box } = attaching;
  const { name } = attachment;
  const failed = (text: string) => {
    attaching.remove(attachment);
    attaching.say(`upload-failed-${attachment.key}`, text);
  };
  let prepared: Prepared;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (attachment.cancelled) return;
    prepared = await commentsJobs().prepare({ name, bytes });
  } catch (error) {
    if (!attachment.cancelled) failed(`Lo couldn’t read ${name}: ${describe(error)}`);
    return;
  }
  if (attachment.cancelled) return;
  // An upload before it found the view takes none: the box says so, and this one isn't sent.
  if (uploadsOff(box.view) !== undefined) {
    attaching.remove(attachment);
    return;
  }
  if (prepared.kind === 'refused') {
    failed(`Lo didn’t attach ${name}: ${prepared.why}.`);
    return;
  }
  const said = metadataNote(name, prepared.metadata);
  if (said !== undefined) {
    attachment.notes.push({
      key: `upload-metadata-${attachment.key}`,
      // Sent as it is, with whatever it holds.
      tone: prepared.metadata.kind === 'asIs' ? 'warning' : 'info',
      text: said,
    });
  }
  if (prepared.paidPlan) {
    attachment.notes.push({
      key: `upload-paid-${attachment.key}`,
      tone: 'warning',
      text: `GitHub takes a video over 10 MB, as ${name} is, only on a paid plan.`,
    });
  }
  attachment.stage = 'uploading';
  attaching.changed();
  underway.set(attachment.key, { attaching, file: attachment });
  const login = loginOf(box.view);
  let outcome: UploadOutcome;
  try {
    outcome = await main().upload({
      id: box.view,
      upload: attachment.key,
      name: prepared.name,
      bytes: prepared.bytes,
    });
  } catch (error) {
    outcome = { kind: 'failed', message: describe(error) };
  } finally {
    underway.delete(attachment.key);
  }
  if (attachment.cancelled) return;
  switch (outcome.kind) {
    case 'uploaded':
      attachment.stage = 'uploaded';
      attachment.markdown = outcome.markdown;
      // Its placeholder went meanwhile: its row offers to insert it.
      attachment.unplaced = !edit(box, (text) =>
        inPlaceOf(text, attachment.placeholder, outcome.markdown),
      );
      if (outcome.viaGh) {
        attachment.notes.push({
          key: `upload-gh-${attachment.key}`,
          tone: 'info',
          text: `GitHub took no upload with Lo’s sign-in, so Lo sent ${name} with gh’s.`,
        });
      }
      attaching.changed();
      return;
    case 'refused': {
      const { refusal } = outcome;
      if (refusal.kind === 'cantWrite' || refusal.kind === 'needsGh') {
        attaching.remove(attachment);
        if (login !== undefined) setOff(box.view, login, refusal);
        return;
      }
      failed(refusedText(name, refusal));
      return;
    }
    case 'cancelled':
      attaching.remove(attachment);
      return;
    case 'failed':
      failed(`${name} didn’t upload: ${outcome.message}`);
      return;
    default:
      outcome satisfies never;
  }
}

/** Main says how far an upload has gone. */
export function takeProgress({ upload, sent, total }: UploadProgressRow): void {
  const going = underway.get(upload);
  if (!going || total <= 0) return;
  going.file.progress = Math.min(1, sent / total);
  going.attaching.changed();
}

/** Gives up the upload `key` in `box`, as its "Cancel" does: it and its placeholder go. */
export function cancelUpload(box: Attachable, key: string): void {
  const attaching = attachings.get(box);
  const attachment = attaching?.files.find((file) => file.key === key);
  if (!attaching || !attachment || attachment.stage === 'uploaded') return;
  attachment.cancelled = true;
  attaching.remove(attachment);
  main()
    .cancelUpload({ id: box.view, upload: key })
    .catch((error: unknown) => console.error("Lo couldn't cancel an upload:", error));
}

/**
 * Gives up every file still on its way into `box`, and forgets them all, as its draft goes, or once
 * what it held is sent: nothing more goes into its text.
 */
export function endUploads(box: Attachable): void {
  const attaching = attachings.get(box);
  if (!attaching) return;
  for (const file of attaching.running) {
    file.cancelled = true;
    // One still being prepared never reaches main.
    if (file.stage !== 'uploading') continue;
    main()
      .cancelUpload({ id: box.view, upload: file.key })
      .catch((error: unknown) => console.error("Lo couldn't cancel an upload:", error));
  }
  attaching.files.length = 0;
  attaching.said = [];
  attaching.dropping = 0;
  attaching.changed();
}

/**
 * Puts the Markdown of upload `key` in `box` at its cursor, as its row's "Insert" does, for one
 * whose placeholder went while it uploaded.
 */
export function insertUpload(box: Attachable, key: string): void {
  const attaching = attachings.get(box);
  const file = attaching?.files.find((each) => each.key === key);
  if (!attaching || !file?.unplaced || file.markdown === undefined || !box.composer) return;
  box.composer.insert(file.markdown);
  file.unplaced = false;
  attaching.changed();
}

/** Files are dragged over `box`: how many, or 0 once they're dropped or leave. */
export function draggingOver(box: Attachable, count: number): void {
  const attaching = attachingOf(box);
  if (attaching.dropping === count) return;
  attaching.dropping = count;
  attaching.changed();
}

/** What a picker takes: the kinds GitHub takes. */
const ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp4',
  '.mov',
  '.webm',
].join(',');

/** "Attach" (`⌘⇧A`): picks files with the system's picker, and attaches them to `box`. */
export function pickFiles(box: Attachable): void {
  const why = whyNoAttach(box.view);
  if (why !== undefined) {
    attachFiles(box, []);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.addEventListener(
    'change',
    () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) attachFiles(box, files);
    },
    { once: true },
  );
  input.click();
}

/**
 * An image's `https` address, from text pasted or dropped, with the alt text its file name gives:
 * one address alone, whose path ends as an image's does.
 */
export function imageAddress(text: string): { url: string; alt: string } | undefined {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined;
  const file = url.pathname.split('/').at(-1) ?? '';
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(file)) return undefined;
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    // Kept as it is.
  }
  return { url: url.href.replace(/[()]/g, (paren) => encodeURIComponent(paren)), alt: altOf(name) };
}

/**
 * While `box`'s view takes no uploads, an image's `https` address pasted or dropped into it goes in
 * as an image. Listens on `frame`, the box's element, before its editor; returns what stops it.
 */
export function takeAddresses(frame: HTMLElement, box: Attachable): () => void {
  const take = (event: Event, text: string | undefined) => {
    if (uploadsOff(box.view) === undefined || text === undefined) return;
    const found = imageAddress(text);
    if (!found || !box.composer) return;
    event.preventDefault();
    event.stopPropagation();
    box.composer.insert(`![${found.alt}](${found.url})`);
  };
  const paste = (event: ClipboardEvent) => {
    if ((event.clipboardData?.files.length ?? 0) > 0) return;
    take(event, event.clipboardData?.getData('text/plain'));
  };
  const drop = (event: DragEvent) => {
    const carried = event.dataTransfer;
    if (!carried || carried.files.length > 0) return;
    const uris = carried
      .getData('text/uri-list')
      .split(/\r?\n/)
      .filter((line) => line !== '' && !line.startsWith('#'));
    take(event, uris.length === 1 ? uris[0] : carried.getData('text/plain'));
  };
  const capture = { capture: true } as const;
  frame.addEventListener('paste', paste, capture);
  frame.addEventListener('drop', drop, capture);
  return () => {
    frame.removeEventListener('paste', paste, capture);
    frame.removeEventListener('drop', drop, capture);
  };
}
