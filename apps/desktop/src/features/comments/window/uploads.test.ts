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
  sizeText,
  takeAddresses,
  takeProgress,
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
    connection: { kind: said.offline ? 'offline' : 'live' },
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
        return Promise.resolve({ kind: 'refused', why: 'GitHub doesn’t take this kind' });
      }
      return Promise.resolve({
        kind: 'prepared',
        name: input.name,
        bytes: new Uint8Array(input.bytes),
        size: '8 bytes',
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
    dismiss() {},
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

/** Whether a file is on its way into `box`. */
function running(box: Attachable): boolean {
  return uploadsHold(box)?.kind === 'running';
}

/** What `box` says holds its comment, if anything does. */
function held(box: Attachable): string | undefined {
  const hold = uploadsHold(box);
  return hold?.kind === 'stranded' ? hold.text : hold?.kind;
}

describe('the text', () => {
  test('a placeholder names the file, told apart from one already in the text', () => {
    const first = placeholderFor('retry-storm.gif', '');
    expect(first).toBe('![retry-storm](uploading retry-storm.gif…)');
    expect(placeholderFor('retry-storm.gif', `a\n${first}`)).toBe(
      '![retry-storm](uploading retry-storm.gif (2)…)',
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

  test('sizes and what Lo took out read as people say them', () => {
    expect([sizeText(512), sizeText(217_088), sizeText(3_565_158)]).toEqual([
      '512 bytes',
      '212 KB',
      '3.4 MB',
    ]);
    const removed = { location: true, other: true, embedded: false };
    expect(metadataNote('shot.jpg', { kind: 'image', removed })).toBe(
      'Lo removed where shot.jpg was taken and its other metadata before uploading it.',
    );
    expect(
      metadataNote('shot.png', {
        kind: 'image',
        removed: { location: false, other: false, embedded: false },
      }),
    ).toBeUndefined();
    expect(metadataNote('storm.gif', { kind: 'asIs' })).toBe(
      'Lo couldn’t remove metadata from storm.gif, so it uploads as it is.',
    );
    expect(metadataNote('demo.mov', { kind: 'video', removed: { ...removed, other: false } })).toBe(
      'Lo removed where demo.mov was filmed before uploading it. The rest of its metadata stays, such as when it was filmed and on what.',
    );
  });
});

describe('attaching', () => {
  test('a file goes in as a placeholder at once, then as its Markdown once it’s uploaded', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    const placeholder = '![retry-storm](uploading retry-storm.png…)';
    expect(box.text()).toBe(`Repro: ${placeholder}`);
    expect(running(box)).toBe(true);
    const { state } = attachingOf(box);
    expect(state.rows).toMatchObject([
      { name: 'retry-storm.png', size: '8 bytes', uploaded: false },
    ]);
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
      'Lo removed where retry-storm.png was taken before uploading it.',
    ]);
  });

  test('a file of a kind GitHub doesn’t take gets no placeholder, and the box says why', async () => {
    const box = boxWith();
    attachFiles(box, [new File(['hi'], 'notes.txt')]);
    expect(box.text()).toBe('Repro: ');
    await settle();
    // Nothing of it was read.
    expect(asked.prepare).toEqual([{ name: 'notes.txt', bytes: null }]);
    expect(attachingOf(box).state.notes.map(({ text }) => text)).toEqual([
      'Lo didn’t attach notes.txt: GitHub doesn’t take this kind.',
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
    expect(attachingOf(box).state.notes.at(-1)?.text).toBe(
      'Lo attaches 10 files at a time, so it left out 2 files.',
    );
    // Once one is in, there's room for another.
    await settle();
    asked.answers[0]!({ kind: 'uploaded', markdown: `![shot-0](${ASSET})`, viaGh: false });
    await settle();
    attachFiles(box, [png('shot-12.png'), png('shot-13.png')]);
    expect(attachingOf(box).state.rows).toHaveLength(11);
    expect(attachingOf(box).state.notes.at(-1)?.text).toBe(
      'Lo attaches 10 files at a time, so it left out 1 file.',
    );
  });

  test('a file whose metadata Lo can’t read says it goes as it is', async () => {
    const box = boxWith();
    attachFiles(box, [png('storm.gif')]);
    await settle();
    expect(attachingOf(box).state.notes).toContainEqual(
      expect.objectContaining({
        tone: 'warning',
        text: 'Lo couldn’t remove metadata from storm.gif, so it uploads as it is.',
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
    expect(attachingOf(box).state.notes.map(({ text }) => text)).toEqual([
      'retry-storm.png didn’t upload: GitHub refused it: Bad size.',
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
    expect(whyNoAttach('v2')).toBe(
      'Uploads here need gh’s sign-in, since GitHub takes none with Lo’s. Paste an image’s web address instead.',
    );
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
    expect(attachingOf(box).state.notes.map(({ text }) => text)).toEqual([
      'Offline. Attach files once Lo can reach GitHub.',
    ]);
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
    expect(attachingOf(closed).state.notes.map(({ text }) => text)).toContain(
      'GitHub took no upload with Lo’s sign-in, so Lo sent retry-storm.png with gh’s.',
    );
  });
});

describe('a placeholder whose upload isn’t under way', () => {
  test('holds the comment, saying which file didn’t finish, until the reader takes it out', () => {
    // As after Lo restarts with a file on its way in: the draft comes back with its placeholder.
    const box = boxWith('Repro: ![retry-storm](uploading retry-storm.png (2)…)');
    expect(held(box)).toBe(
      'retry-storm.png didn’t finish uploading. Attach it again, and take out its placeholder.',
    );
    // Partly edited, it still holds it.
    const edited = boxWith('Repro: ![retry-storm](uploading retry-st');
    expect(held(edited)).toBe('Take out what’s left of an upload’s placeholder.');
    const two = boxWith('![a](uploading a.png…) ![b](uploading b.gif…)');
    expect(held(two)).toBe(
      'a.png and b.gif didn’t finish uploading. Attach them again, and take out their placeholders.',
    );
    // Nothing is taken out by itself; once the reader has, the comment goes.
    expect(box.text()).toBe('Repro: ![retry-storm](uploading retry-storm.png (2)…)');
    expect(held(boxWith('Repro: uploading takes a while (see the logs).'))).toBeUndefined();
  });

  test('one under way holds it as uploading, and only its own placeholder counts as under way', async () => {
    const box = boxWith('Old: ![retry-storm](uploading retry-storm.png…)\n');
    attachFiles(box, [png()]);
    expect(held(box)).toBe('running');
    await settle();
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe(
      `Old: ![retry-storm](uploading retry-storm.png…)\n![retry-storm](${ASSET})`,
    );
    expect(held(box)).toBe(
      'retry-storm.png didn’t finish uploading. Attach it again, and take out its placeholder.',
    );
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
    expect(held(box)).toBeUndefined();
    insertUpload(box, attachingOf(box).state.rows[0]!.key);
    expect(box.text()).toBe(`Repro: ![retry-storm](${ASSET})`);
    expect(attachingOf(box).state.rows).toMatchObject([{ uploaded: true, unplaced: false }]);
  });

  test('partly edited while it uploaded, it holds the comment and says so', async () => {
    const box = boxWith();
    attachFiles(box, [png()]);
    await settle();
    // The ellipsis and the bracket after it went.
    box.composer!.replace(box.text().length - 2, box.text().length, '');
    asked.answers[0]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(box.text()).toBe('Repro: ![retry-storm](uploading retry-storm.png');
    expect(attachingOf(box).state.rows).toMatchObject([{ unplaced: true }]);
    expect(held(box)).toBe('Take out what’s left of an upload’s placeholder.');
    // With its name and ellipsis left, it's named.
    const named = boxWith();
    attachFiles(named, [png()]);
    await settle();
    named.composer!.replace(7, 9, '');
    asked.answers[1]!({ kind: 'uploaded', markdown: `![retry-storm](${ASSET})`, viaGh: false });
    await settle();
    expect(held(named)).toBe(
      'Lo didn’t put retry-storm.png in, as its placeholder changed. Take it out, and “Insert” puts the file at the cursor.',
    );
  });
});

describe('a view whose account can’t write to the repository', () => {
  const CANT =
    'GitHub takes uploads only from people who can write to e2e. Paste an image’s web address instead.';

  test('takes no file: nothing goes in, and nothing is read or sent', async () => {
    keepUploadsOf(new Set());
    let answer!: (check: AttachCheck) => void;
    asked.attachable['v1'] = new Promise((resolve) => {
      answer = resolve;
    });
    const box = boxWith();
    // Dropped before main has said: it waits.
    attachFiles(box, [png()]);
    expect(box.text()).toBe('Repro: ');
    answer({ kind: 'cantWrite', login: 'rozed-bot', repo: 'e2e' });
    await settle();
    expect(box.text()).toBe('Repro: ');
    expect(whyNoAttach('v1')).toBe(CANT);
    attachFiles(box, [png()]);
    expect(box.text()).toBe('Repro: ');
    expect([asked.prepare, asked.upload]).toEqual([[], []]);
    // Its note is the view's, which the frame shows.
    expect(attachingOf(box).state.notes).toEqual([]);
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
