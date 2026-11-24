// @vitest-environment jsdom
// Files attached to a comment box: a placeholder at the cursor at once, the Markdown in its place
// once main has uploaded the file, and gone when it's refused, fails or is cancelled; what the box
// says meanwhile; a placeholder whose upload isn't under way, which holds the comment; and a view
// whose boxes take no uploads.

import type { Composer } from '@lo/ui/code';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { AttachCheck, UploadOutcome } from '../contract.ts';
import type { PrepareInput, Prepared } from '../jobs.ts';
import {
  type Attachable,
  attachFiles,
  attachingOf,
  cancelUpload,
  checkUploads,
  endUploads,
  imageAddress,
  inPlaceOf,
  insertUpload,
  keepUploadsOf,
  metadataNote,
  placeholderFor,
  refusalSays,
  takeAddresses,
  takeProgress,
  clearStranded,
  uploadsHold,
  WARNING,
  whyNoAttach,
  withoutPlaceholder,
} from './uploads.ts';

const said = vi.hoisted(() => ({ offline: false }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => ({
    acting: { kind: 'account', login: 'rozed-bot' },
    connection: said.offline
      ? { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: '' }
      : { kind: 'live' },
  }),
  runOf: () => undefined,
}));

/** What main and the background process are asked, and how they answer. */
const asked = vi.hoisted(() => ({
  prepare: [] as unknown[],
  upload: [] as { id: string; upload: string; name: string }[],
  cancelled: [] as string[],
  /** Each upload's answer, given by the test once it's asked. */
  answers: [] as ((outcome: UploadOutcome) => void)[],
  /** Whether each view's account can upload, as main says. */
  attachable: {} as Record<string, AttachCheck | Promise<AttachCheck>>,
}));
vi.mock('./main.ts', () => ({
  commentsJobs: () => ({
    prepare(input: PrepareInput): Promise<Prepared> {
      asked.prepare.push(input);
      if (input.bytes === null || !/\.(png|gif)$/.test(input.name)) {
        return Promise.resolve({ kind: 'refused', refusal: { reason: 'unsupported' } });
      }
      return Promise.resolve({
        kind: 'prepared',
        name: input.name,
        bytes: new Uint8Array(input.bytes),
        // Lo reads a PNG's metadata, and not a GIF's.
        metadata: input.name.endsWith('.png')
          ? { kind: 'image', removed: { location: true, other: false, embedded: false } }
          : { kind: 'asIs' },
        paidPlan: false,
      });
    },
  }),
  main: () => ({
    attachable({ id }: { id: string }): Promise<AttachCheck> {
      return Promise.resolve(asked.attachable[id] ?? { kind: 'open', login: 'rozed-bot' });
    },
    upload(input: { id: string; upload: string; name: string }): Promise<UploadOutcome> {
      asked.upload.push(input);
      return new Promise((resolve) => {
        asked.answers.push(resolve);
      });
    },
    cancelUpload({ upload }: { upload: string }): Promise<void> {
      asked.cancelled.push(upload);
      return Promise.resolve();
    },
  }),
}));

const ASSET = 'https://github.com/user-attachments/assets/2c8f1e6f-0846-4210-a57f-c0c6b27e9717';

let made = 0;

/** A box whose editor's cursor is at the end of `text`. */
function boxWith(text = 'Repro: ', view = 'v1'): Attachable & { text(): string } {
  let current = text;
  const composer: Composer = {
    get text() {
      return current;
    },
    mode: 'insert',
    previewing: false,
    insert(more: string) {
      current += more;
    },
    replace(from: number, to: number, put: string) {
      current = current.slice(0, from) + put + current.slice(to);
    },
    focus() {},
    preview() {},
    hold() {},
    close() {},
    leave() {},
    dismiss() {},
    keep: () => ({ text: current, editor: undefined }),
  };
  made += 1;
  return {
    id: `box-${made}`,
    view,
    composer,
    state: { text: current },
    rewrite: () => {
      throw new Error('the box is drawn');
    },
    text: () => current,
  };
}

function png(name = 'retry-storm.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name);
}

/** Lets what's under way go as far as it can. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  asked.prepare.length = 0;
  asked.upload.length = 0;
  asked.cancelled.length = 0;
  asked.answers.length = 0;
  asked.attachable = {};
  said.offline = false;
  keepUploadsOf(new Set());
  // Main has said whether the account can upload, as it has once a view's diff is drawn.
  await Promise.all(['v1', 'v2'].map((view) => checkUploads(view) ?? Promise.resolve()));
});

/** A box's text with one placeholder after "Repro: ", for retry-storm.png. */
const PLACED = /^Repro: !\[Uploading retry-storm\.png…\]\(lo-upload:[0-9a-f]{16}\)$/;

/** Whether a file is on its way into `box`. */
function running(box: Attachable): boolean {
  return uploadsHold(box)?.kind === 'running';
}

/** What `box` says of its files, each note's title and text. */
function notes(box: Attachable): (string | undefined)[][] {
  return attachingOf(box).state.notes.map((note) => [note.title, note.text]);
}

describe('the text', () => {
  test('a placeholder names the file, with its upload’s token', () => {
    expect(placeholderFor('retry-storm.gif', '9f86d081884c7d65')).toBe(
      '![Uploading retry-storm.gif…](lo-upload:9f86d081884c7d65)',
    );
    expect(placeholderFor('[draft]\nshot.png', '0123456789abcdef')).toBe(
      '![Uploading \\[draft\\] shot.png…](lo-upload:0123456789abcdef)',
    );
  });

  test('a placeholder goes with the line break that set it apart, or becomes its Markdown', () => {
    expect(withoutPlaceholder('a\nP\nb', 'P')).toEqual({ from: 2, to: 4, insert: '' });
    expect(withoutPlaceholder('a\nP', 'P')).toEqual({ from: 1, to: 3, insert: '' });
    expect(withoutPlaceholder('gone', 'P')).toBeUndefined();
    expect(inPlaceOf('a P b', 'P', '![x](y)')).toEqual({ from: 2, to: 3, insert: '![x](y)' });
  });

  test('an image’s https address goes in as an image; anything else as it is', () => {
    expect(imageAddress(' https://example.com/shots/retry%20storm.gif ')).toEqual({
      url: 'https://example.com/shots/retry%20storm.gif',
      alt: 'retry storm',
    });
    for (const text of [
      'http://example.com/a.png',
      'https://example.com/page',
      'see https://example.com/a.png',
      'https://user:pass@example.com/a.png',
    ]) {
      expect(imageAddress(text)).toBeUndefined();
    }
  });

  test('what Lo took out reads as people say it', () => {
    const removed = { location: true, other: true, embedded: false };
    expect(metadataNote('shot.jpg', { kind: 'image', removed })).toBe(
      'shot.jpg · location and metadata removed',
    );
    expect(
      metadataNote('shot.png', {
        kind: 'image',
        removed: { location: false, other: false, embedded: false },
      }),
    ).toBeUndefined();
    expect(metadataNote('storm.gif', { kind: 'asIs' })).toBe('storm.gif · metadata not removed');
    expect(metadataNote('demo.mov', { kind: 'video', removed: { ...removed, other: false } })).toBe(
      'demo.mov · location removed',
    );
  });

  test('why a file isn’t attached reads as a sentence, with its limit as sizes are written', () => {
    expect(refusalSays({ reason: 'tooLarge', limit: 100 * 1024 * 1024 })).toBe(
      'It’s larger than GitHub’s 100 MB.',
    );
    expect(refusalSays({ reason: 'mislabelled', kind: 'jpeg' })).toBe(
      'Its name says JPEG, but it isn’t.',
    );
    expect(refusalSays({ reason: 'empty' })).toBe('It’s empty.');
  });
});

describe('attaching', () => {
  test('a file goes in as a placeholder at once, then as its Markdown once it’s uploaded', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    expect(box.text()).toMatch(PLACED);
    expect(running(box)).toBe(true);
    const { state } = attachingOf(box);
    expect(state.rows).toMatchObject([{ name: 'retry-storm.png', size: '8 B', uploaded: false }]);
    expect(state.notes[0]).toEqual({ key: 'upload-warning', tone: 'warning', text: WARNING });
    await settle();
    expect(asked.upload).toMatchObject([{ id: 'v1', name: 'retry-storm.png' }]);
    const [sent] = asked.upload;
    takeProgress({ id: 'v1', upload: sent!.upload, sent: 4, total: 8 });
    expect(attachingOf(box).state.rows[0]?.progress).toBe(0.5);
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe(`Repro: ![retry-storm](${ASSET})`);
    expect(running(box)).toBe(false);
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true }]);
    expect(attachingOf(box).state.notes.map(({ text }) => text)).toEqual([
      WARNING,
      'retry-storm.png · location removed',
    ]);
  });

  test('a file of a kind GitHub doesn’t take gets no placeholder, and the box says why', async () => {
    const box = boxWith();
    attachFiles(box, [new File(['hi'], 'notes.txt')]);
    expect(box.text()).toBe('Repro: ');
    await settle();
    // Nothing of it was read.
    expect(asked.prepare).toEqual([{ name: 'notes.txt', bytes: null }]);
    expect(attachingOf(box).state.notes.map(({ title, text }) => [title, text])).toEqual([
      [
        'Couldn’t attach notes.txt',
        'GitHub takes PNG, JPEG, GIF, WebP and SVG images and MP4, MOV and WebM videos.',
      ],
    ]);
    expect(asked.upload).toEqual([]);
  });

  test('ten files go into a box at a time, however many drops they come in', async () => {
    const box = boxWith('');
    const shots = (from: number) =>
      Array.from({ length: 6 }, (_, at) => png(`shot-${from + at}.png`));
    attachFiles(box, shots(0));
    attachFiles(box, [...shots(6), new File(['hi'], 'notes.txt')]);
    expect(attachingOf(box).state.rows).toHaveLength(10);
    expect(attachingOf(box).state.notes.at(-1)).toMatchObject({
      title: 'Couldn’t attach 2 files',
      text: '10 files attach at a time.',
    });
    // Once one is in, there's room for another.
    await settle();
    asked.answers[0]!({ kind: 'uploaded', markdown: `![shot-0](${ASSET})`, viaGh: false });
    await settle();
    attachFiles(box, [png('shot-12.png'), png('shot-13.png')]);
    expect(attachingOf(box).state.rows).toHaveLength(11);
    expect(attachingOf(box).state.notes.at(-1)).toMatchObject({
      title: 'Couldn’t attach shot-13.png',
      text: '10 files attach at a time.',
    });
  });

  test('a file whose metadata Lo can’t read says it goes as it is', async () => {
    const box = boxWith();
    attachFiles(box, [png('storm.gif')]);
    await settle();
    expect(attachingOf(box).state.notes).toContainEqual(
      expect.objectContaining({
        tone: 'warning',
        text: 'storm.gif · metadata not removed',
      }),
    );
  });

  test('“Cancel” takes the file and its placeholder out at once, and asks main to give it up', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    const [sent] = asked.upload;
    cancelUpload(box, sent!.upload);
    expect(box.text()).toBe('Repro: ');
    expect(attachingOf(box).state.rows).toEqual([]);
    expect(asked.cancelled).toEqual([sent!.upload]);
    expect(running(box)).toBe(false);
    asked.answers[0]!({ kind: 'cancelled' });
    await settle();
    expect(box.text()).toBe('Repro: ');
  });

  test('a failed upload’s placeholder goes, and the box says why; nothing is sent again', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    asked.answers[0]!({ kind: 'failed', message: 'GitHub refused it: Bad size.' });
    await settle();
    expect(box.text()).toBe('Repro: ');
    // Why isn't known in the reader's words: the title alone, and the foot's "Attach files…".
    expect(attachingOf(box).state.notes.map(({ title, text }) => [title, text])).toEqual([
      ['Couldn’t attach retry-storm.png', ''],
    ]);
    expect(asked.upload).toHaveLength(1);
  });

  test('where gh’s sign-in is needed, the view’s boxes take no more uploads', async () => {
    const box = boxWith('', 'v2');
    attachFiles(box, [png(), png('second.png')]);
    await settle();
    asked.answers[0]!({ kind: 'refused', refusal: { kind: 'needsGh' } });
    await settle();
    // The file after it in the drop isn't sent either.
    expect(box.text()).toBe('');
    expect(asked.upload).toHaveLength(1);
    expect(running(box)).toBe(false);
    expect(whyNoAttach('v2')).toBe('Sign in to GitHub CLI to attach files');
    const other = boxWith('', 'v2');
    attachFiles(other, [png()]);
    expect(other.text()).toBe('');
    expect(whyNoAttach('v1')).toBeUndefined();
  });

  test('offline, nothing is attached, and the box says so', () => {
    said.offline = true;
    const box = boxWith();
    attachFiles(box, [png()]);
    expect(box.text()).toBe('Repro: ');
    expect(attachingOf(box).state.notes.map(({ text }) => text)).toEqual(['Offline']);
  });

  test('a box no longer drawn takes the Markdown into its draft', async () => {
    const box = boxWith();
    const kept: string[] = [];
    const closed: Attachable = {
      id: 'closed',
      view: 'v1',
      get composer() {
        return kept.length === 0 ? box.composer : undefined;
      },
      get state() {
        return { text: kept.at(-1) ?? box.text() };
      },
      rewrite: (text) => kept.push(text),
    };
    attachFiles(closed, [png()]);
    await settle();
    kept.push(box.text());
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: true });
    await settle();
    expect(kept.at(-1)).toBe(`Repro: ![retry-storm](${ASSET})`);
    // Which sign-in sent it is nothing the reader acts on: no note says it.
    expect(attachingOf(closed).state.notes.map(({ text }) => text)).not.toContainEqual(
      expect.stringContaining('sign-in'),
    );
  });
});

describe('a placeholder whose upload isn’t under way', () => {
  const ONE = placeholderFor('retry-storm.png', '9f86d081884c7d65');
  const LOST = [['Couldn’t attach retry-storm.png', '']];

  test('goes from the text by itself, with the file named to attach again', () => {
    // As after Lo restarts with a file on its way in: the draft comes back with its placeholder.
    const box = boxWith(`Repro: ${ONE}`);
    expect(running(box)).toBe(false);
    clearStranded(box);
    expect(box.text()).toBe('Repro: ');
    expect(notes(box)).toEqual(LOST);
    // Partly edited, what's left of it goes too.
    const cut = boxWith(`Repro: ${ONE.slice(1, -1)} then`);
    clearStranded(cut);
    expect(cut.text()).toBe('Repro:  then');
    expect(notes(cut)).toEqual(LOST);
    // With its name gone, there's no file to name.
    const bare = boxWith('Repro: ![retry](lo-upload:9f86d081884c7d65');
    clearStranded(bare);
    expect(bare.text()).toBe('Repro: ');
    expect(notes(bare)).toEqual([]);
    const two = boxWith(
      `${placeholderFor('a.png', '0000000000000001')} ${placeholderFor('b.gif', '0000000000000002')}`,
    );
    clearStranded(two);
    expect(two.text()).toBe(' ');
    expect(notes(two)).toEqual([
      ['Couldn’t attach a.png', ''],
      ['Couldn’t attach b.gif', ''],
    ]);
  });

  test('is only one Lo wrote: what’s typed or pasted like one stays as it is', () => {
    for (const text of [
      'Retries stall while uploading big files… then time out.',
      'See [notes](uploading guide.md).',
      '```suggestion\nlog.info("uploading %d files…", count);\n```',
      '![shot](lo-upload:not-a-token)',
    ]) {
      const box = boxWith(text);
      clearStranded(box);
      expect(box.text()).toBe(text);
      expect(notes(box)).toEqual([]);
    }
  });

  test('one under way holds the comment as uploading, and only its own placeholder stays', async () => {
    const box = boxWith(`Old: ${ONE}\n`);
    attachFiles(box, [png()]);
    expect(running(box)).toBe(true);
    clearStranded(box);
    expect(box.text()).toMatch(/^Old: !\[Uploading retry-storm\.png…\]\(lo-upload:[0-9a-f]{16}\)$/);
    await settle();
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe(`Old: ![retry-storm](${ASSET})`);
    expect(running(box)).toBe(false);
  });

  test('taken out while it uploaded, its row says so and offers to put it in at the cursor', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    box.composer!.replace(0, box.text().length, 'Repro: ');
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe('Repro: ');
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true, unplaced: true }]);
    expect(running(box)).toBe(false);
    insertUpload(box, attachingOf(box).state.rows[0]!.key);
    expect(box.text()).toBe(`Repro: ![retry-storm](${ASSET})`);
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true, unplaced: false }]);
  });

  test('partly edited while it uploaded, what’s left of it goes and its row offers to insert it', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    // The bracket at its end went.
    box.composer!.replace(box.text().length - 1, box.text().length, '');
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe('Repro: ');
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true, unplaced: true }]);
    // The file is uploaded, so nothing says to attach it again.
    expect(notes(box).map(([title]) => title)).not.toContain('Couldn’t attach retry-storm.png');
  });

  test('back whole once its file is uploaded, as when its going in is undone, the file goes in', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    const placeholder = box.text().slice('Repro: '.length);
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    box.composer!.replace(0, box.text().length, `Repro: ${placeholder}`);
    clearStranded(box);
    expect(box.text()).toBe(`Repro: ![retry-storm](${ASSET})`);
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true, unplaced: false }]);
  });
});

describe('a view whose account can’t write to the repository', () => {
  const CANT = 'rozed-bot can’t attach files in e2e';

  test('dropped on before main says, a file goes in at once, and out again once main says it can’t', async () => {
    keepUploadsOf(new Set());
    let answer!: (check: AttachCheck) => void;
    asked.attachable['v1'] = new Promise((resolve) => {
      answer = resolve;
    });
    const box = boxWith();
    attachFiles(box, [png()]);
    expect(box.text()).toMatch(PLACED);
    expect(whyNoAttach('v1')).toBeUndefined();
    answer({ kind: 'cantWrite', login: 'rozed-bot', repo: 'e2e' });
    await settle();
    // Main refuses what reached it before it said, as it checks again before sending.
    for (const reply of asked.answers.splice(0)) {
      reply({ kind: 'refused', refusal: { kind: 'cantWrite', repo: 'e2e' } });
    }
    await settle();
    expect(box.text()).toBe('Repro: ');
    expect(whyNoAttach('v1')).toBe(CANT);
    expect(attachingOf(box).state.rows).toEqual([]);
  });

  test('once main has said, a file dropped puts nothing in, and nothing is read or sent', async () => {
    keepUploadsOf(new Set());
    asked.attachable['v1'] = { kind: 'cantWrite', login: 'rozed-bot', repo: 'e2e' };
    await checkUploads('v1');
    const box = boxWith();
    attachFiles(box, [png()]);
    expect(box.text()).toBe('Repro: ');
    await settle();
    expect([asked.prepare, asked.upload]).toEqual([[], []]);
    // Its note is the view's, which the frame shows.
    expect(attachingOf(box).state.notes).toEqual([]);
    expect(whyNoAttach('v1')).toBe(CANT);
    expect(whyNoAttach('v2')).toBeUndefined();
  });

  test('takes an image’s address pasted in as an image, at once', async () => {
    keepUploadsOf(new Set());
    asked.attachable['v1'] = { kind: 'cantWrite', login: 'rozed-bot', repo: 'e2e' };
    await checkUploads('v1');
    const box = boxWith();
    const frame = document.createElement('div');
    const stop = takeAddresses(frame, box);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [], getData: () => 'https://example.com/shots/retry-storm.gif' },
    });
    frame.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(box.text()).toBe('Repro: ![retry-storm](https://example.com/shots/retry-storm.gif)');
    stop();
    expect(asked.upload).toEqual([]);
  });
});

describe('a box whose draft goes', () => {
  test('gives up what’s uploading, and nothing it uploaded goes into the text after', async () => {
    const box = boxWith();
    attachFiles(box, [png(), png('second.png')]);
    await settle();
    box.composer!.replace(0, box.text().length, '');
    endUploads(box);
    expect(asked.cancelled).toEqual([asked.upload[0]!.upload]);
    expect(attachingOf(box).state.rows).toEqual([]);
    expect(running(box)).toBe(false);
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe('');
    // The file after it isn't sent.
    expect(asked.upload).toHaveLength(1);
  });
});
