// @vitest-environment jsdom
// Files attached to a comment box: a placeholder at the cursor at once, the Markdown in its place
// once main has uploaded the file, and gone when it's refused, fails or is cancelled; what the box
// says meanwhile; and a view whose boxes take no uploads.

import type { Composer } from '@lo/ui/code';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { UploadOutcome } from '../contract.ts';
import type { PrepareInput, Prepared } from '../jobs.ts';
import {
  type Attachable,
  attachFiles,
  attachingOf,
  cancelUpload,
  imageAddress,
  inPlaceOf,
  keepUploadsOf,
  metadataNote,
  placeholderFor,
  sizeText,
  takeProgress,
  uploadsRunning,
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
}));
vi.mock('./main.ts', () => ({
  commentsJobs: () => ({
    prepare(input: PrepareInput): Promise<Prepared> {
      asked.prepare.push(input);
      if (input.bytes === null || !input.name.endsWith('.png')) {
        return Promise.resolve({ kind: 'refused', why: 'GitHub doesn’t take this kind' });
      }
      return Promise.resolve({
        kind: 'prepared',
        name: input.name,
        bytes: new Uint8Array(input.bytes),
        size: '8 bytes',
        metadata: { kind: 'image', removed: { location: true, other: false, embedded: false } },
        paidPlan: false,
      });
    },
  }),
  main: () => ({
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

beforeEach(() => {
  asked.prepare.length = 0;
  asked.upload.length = 0;
  asked.cancelled.length = 0;
  asked.answers.length = 0;
  said.offline = false;
  keepUploadsOf(new Set());
});

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
    expect(metadataNote('storm.gif', { kind: 'asIs' })).toBeUndefined();
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
    expect(uploadsRunning(box)).toBe(true);
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
    expect(uploadsRunning(box)).toBe(false);
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

  test('ten files go at a time', () => {
    const box = boxWith('');
    attachFiles(
      box,
      Array.from({ length: 12 }, (_, at) => png(`shot-${at}.png`)),
    );
    expect(attachingOf(box).state.rows).toHaveLength(10);
    expect(attachingOf(box).state.notes.at(-1)?.text).toBe(
      'Lo attaches 10 files at a time, so it left out 2 files.',
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
    expect(uploadsRunning(box)).toBe(false);
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
    expect(uploadsRunning(box)).toBe(false);
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
