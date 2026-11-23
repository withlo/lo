// @vitest-environment jsdom
// Code features' keys in the window, with the code port and the diff's code views stood in for:
// what each asks, what it shows of the answer, what it says when there's nothing, and that a new
// question cancels the one before.

import type { LineTarget, Place } from '@lo/ui/code';
import { KEY_EVENT } from '@lo/ui/commands';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markdownTree } from '@lo/markdown';

import { IpcError } from '../../../ipc/contract.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { RightKept } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import type { CodeAnswer, Definitions, Hints, Hover, Outline, References } from '../port.ts';
import {
  closePeek,
  closeReferences,
  definition,
  followHints,
  goToAnswer,
  hints,
  hovers,
  listed,
  outline,
  outlines,
  peekIn,
  pick,
  references,
  redrawn,
  rested,
  toggleHints,
  typeOf,
  typeOutline,
  viewClosed,
} from './navigate.ts';
import { said } from './said.ts';
import { servers } from './servers.ts';
import { statuses } from './status.ts';

const HEAD = 'a'.repeat(40);

const seen = vi.hoisted(() => ({
  local: { kind: 'ready' },
  commit: 'a'.repeat(40) as string | undefined,
  asked: [] as { job: string; input: unknown; signal: AbortSignal | undefined }[],
  answers: new Map<string, (input: unknown) => unknown>(),
  peeks: [] as {
    at: unknown;
    shown: number | undefined;
    lines: readonly string[] | undefined;
    waiting?: boolean | undefined;
  }[],
  places: [] as unknown[],
  right: [] as { id: string | undefined; focus: boolean }[],
  rightShown: undefined as string | undefined,
  /** How the right panel stands, and each time it was put back. */
  kept: { open: false, right: undefined } as RightKept,
  put: [] as RightKept[],
  middle: 0,
  /** The hints drawn, in each view by its id and in which of its code views. */
  hints: [] as { tab: string; view: string; hints: unknown }[],
  /** The view on screen: a pull request's tab, or one of its layers. */
  active: 't1',
  /** What `code.hints` was saved as, in order. */
  saved: [] as unknown[],
}));

/** The code port's `job`: noted as asked, and answered as the test says, or never. */
function asking(job: string) {
  return (input: unknown, options?: { signal?: AbortSignal }) => {
    seen.asked.push({ job, input, signal: options?.signal });
    const answering = seen.answers.get(job);
    if (!answering) return new Promise(() => undefined);
    return Promise.resolve(answering(input));
  };
}

vi.mock('./main.ts', () => {
  const port = {
    definitions: asking('definitions'),
    references: asking('references'),
    hover: asking('hover'),
    hints: asking('hints'),
    outline: asking('outline'),
    snippet: asking('snippet'),
  };
  return { port: () => port, main: () => ({}) };
});

vi.mock('../../diff/window/shared.ts', () => ({
  codeViews: (tab: string) => ({
    onScreen: () => 'diff',
    fileAt: (at: Place) => ({ path: 'src/format.ts', commit: seen.commit, change: 'modified', at }),
    inDiff: () => true,
    newOnScreen: () => [{ file: 'f1', lines: 9 }],
    peek(
      _view: string,
      at: Place,
      peek: { shown: number; code?: { lines: readonly string[] }; waiting?: boolean } | undefined,
      frame?: (parts: unknown, peek: unknown) => { destroy(): void },
    ) {
      seen.peeks.push({
        at,
        shown: peek?.shown,
        lines: peek?.code?.lines,
        ...(peek?.waiting ? { waiting: true } : {}),
      });
      if (peek && frame && seen.peeks.filter((each) => each.shown !== undefined).length === 1) {
        frame({ head: 'head', list: 'list', foot: 'foot' }, peek);
      }
      return true;
    },
    anchor: () => ({ left: 10, top: 20, right: 40, bottom: 40 }),
    setHints: (view: string, marks: unknown) => {
      seen.hints.push({ tab, view, hints: marks });
    },
    go: () => true,
  }),
  highlightText: () => Promise.resolve(undefined),
  showPlace: (...args: unknown[]) => {
    seen.places.push(args);
  },
}));

vi.mock('../../settings/window/shared.ts', () => ({
  changeSetting: (_setting: unknown, value: unknown) => {
    seen.saved.push(value);
    return Promise.resolve(true);
  },
}));

vi.mock('../../revisions/window/shared.ts', () => ({
  revisionLabel: () => 'r2',
  revisionsOf: () => undefined,
}));

vi.mock('../../../window/commands/registry.ts', () => ({
  focusMiddle: () => {
    seen.middle += 1;
  },
}));

vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => ({ id: seen.active, kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 }),
  localCopyOf: () => seen.local,
  rightShown: () => seen.rightShown,
  rightKept: () => seen.kept,
  putRight: (_tab: string, kept: RightKept) => {
    seen.put.push(kept);
    seen.kept = kept;
    seen.rightShown = kept.open ? (kept.right ?? 'comments.panel') : undefined;
  },
  showRight: (_tab: string, id: string | undefined, focus = true) => {
    seen.right.push({ id, focus });
    seen.rightShown = id;
    if (id !== undefined) seen.kept = { open: true, right: id };
  },
}));

/** The cursor on `Line` in src/format.ts's first line. */
const PLACE: Place = { file: 'f1', side: 'new', line: 1, column: 14 };
const AT: LineTarget = { kind: 'line', at: PLACE };

function answer(change: Partial<CodeAnswer> = {}): CodeAnswer {
  return {
    key: HEAD,
    side: 'new',
    path: 'src/parser.ts',
    line: 2,
    column: 17,
    name: 'Line',
    kind: 'interface',
    source: 'syntax',
    label: 'Code index',
    changed: true,
    ...change,
  };
}

/** Lets what's waiting on the port settle. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  seen.local = { kind: 'ready' };
  seen.commit = HEAD;
  seen.asked.length = 0;
  seen.answers.clear();
  seen.peeks.length = 0;
  seen.places.length = 0;
  seen.right.length = 0;
  seen.rightShown = undefined;
  seen.kept = { open: false, right: undefined };
  seen.put.length = 0;
  seen.middle = 0;
  seen.hints.length = 0;
  seen.active = 't1';
  seen.saved.length = 0;
  closePeek(peekIn('t1') ?? '');
  said.set('t1', undefined);
  hints.setState({ on: false, pressed: undefined }, true);
  statuses.set('t1', null);
  servers.set('t1', null);
});

describe('gd', () => {
  it('asks nothing before the local copy, or without git, and says why', async () => {
    seen.local = { kind: 'fetching' };
    await definition(AT);
    expect(said.get('t1')?.text).toBe('Fetching local copy…');
    seen.local = { kind: 'noGit' };
    await definition(AT);
    expect(said.get('t1')?.text).toBe('Git wasn’t found');
    // Nor while the side's commit isn't known.
    seen.local = { kind: 'ready' };
    seen.commit = undefined;
    await definition(AT);
    expect(said.get('t1')?.text).toBe('Fetching local copy…');
    expect(seen.asked).toEqual([]);
  });

  it('asks about the word at the cursor, and with no definition says so and opens nothing', async () => {
    seen.answers.set('definitions', (): Definitions => ({
      name: 'parse',
      answers: [],
      more: false,
    }));
    await definition(AT);
    expect(seen.asked[0]).toMatchObject({
      job: 'definitions',
      input: { view: 't1', key: HEAD, path: 'src/format.ts', line: 1, column: 14 },
    });
    expect(said.get('t1')?.text).toBe('No definition of `parse`');
    expect(seen.peeks).toEqual([]);
  });

  it('says what main says, such as that the index waits for the local copy', async () => {
    seen.answers.set('definitions', () => {
      throw new IpcError('unavailable', 'Fetching local copy…');
    });
    await definition(AT).catch(() => undefined);
    expect(said.get('t1')?.text).toBe('Fetching local copy…');
  });

  it('cancels the question before when it’s asked again', async () => {
    void definition(AT);
    void definition(AT);
    expect(seen.asked).toHaveLength(2);
    expect(seen.asked[0]?.signal?.aborted).toBe(true);
    expect(seen.asked[1]?.signal?.aborted).toBe(false);
  });

  it('opens a peek under the line, picks answers with j and k, and goes to one on its side', async () => {
    const lines = { from: 1, text: ['/** A line. */', 'export interface Line {'] };
    seen.answers.set('definitions', (): Definitions => ({
      name: 'Line',
      answers: [
        answer({ lines }),
        answer({ side: 'old', path: 'src/parse.ts', label: 'Code index · same name' }),
      ],
      more: false,
    }));
    seen.answers.set('snippet', () => ({ from: 1, text: ['export interface Line {}'] }));
    await definition(AT);
    expect(seen.peeks[0]).toEqual({ at: AT.at, shown: 0, lines: lines.text });
    expect(peekIn('t1')).toMatchObject({ shown: 0, revision: 'r2', parts: { head: 'head' } });

    // The second answer came without its lines: they're read, then shown.
    pick(1);
    await settle();
    expect(seen.asked.at(-1)).toMatchObject({
      job: 'snippet',
      input: { view: 't1', key: HEAD, path: 'src/parse.ts', line: 2 },
    });
    expect(seen.peeks.at(-1)).toEqual({
      at: AT.at,
      shown: 1,
      lines: ['export interface Line {}'],
    });
    // No further than the last.
    pick(1);
    expect(peekIn('t1')?.shown).toBe(1);

    goToAnswer();
    expect(peekIn('t1')).toBeUndefined();
    expect(seen.peeks.at(-1)).toEqual({ at: AT.at, shown: undefined, lines: undefined });
    expect(seen.places).toEqual([['t1', 'src/parse.ts', 2, { from: 2, to: 2 }, 'old']]);
  });

  it('draws an answer picked the first time as tall as the code it came with', async () => {
    const lines = { from: 1, text: ['export interface Line {'] };
    seen.answers.set('definitions', (): Definitions => ({
      name: 'Line',
      answers: [answer({ lines }), answer({ path: 'src/parse.ts', lines })],
      more: false,
    }));
    await definition(AT);
    pick(1);
    // Its code is there from the first draw: nothing waits for it, so the peek is its height.
    expect(seen.peeks.at(-1)).toEqual({ at: AT.at, shown: 1, lines: lines.text });
    expect(seen.peeks.some((each) => each.waiting)).toBe(false);
    await settle();
    expect(seen.asked.map((each) => each.job)).toEqual(['definitions']);
  });

  it('says only that nothing was found when a language server didn’t answer, which its own item says', async () => {
    seen.answers.set('definitions', (): Definitions => ({
      name: 'parse',
      answers: [],
      more: false,
      fallback: 'TypeScript is starting',
    }));
    await definition(AT);
    expect(said.get('t1')?.text).toBe('No definition of `parse`');
  });

  it('closes the peek on Esc, back on its line', async () => {
    seen.answers.set('definitions', (): Definitions => ({
      name: 'Line',
      answers: [answer()],
      more: false,
    }));
    await definition(AT);
    closePeek();
    expect(peekIn('t1')).toBeUndefined();
    expect(seen.peeks.at(-1)).toEqual({ at: AT.at, shown: undefined, lines: undefined });
  });
});

describe('gr', () => {
  it('lists the references in the right panel, and Esc goes back to the threads', async () => {
    seen.rightShown = 'comments.panel';
    seen.kept = { open: true, right: undefined };
    seen.answers.set('references', (): References => ({
      name: 'Line',
      answers: [answer(), answer({ line: 9 })],
      more: false,
      note: '',
    }));
    seen.answers.set('snippet', () => ({ from: 1, text: ['a', 'export interface Line {'] }));
    await references(AT);
    expect(seen.right).toEqual([{ id: 'code.references', focus: true }]);
    expect(listed.get('t1')).toMatchObject({
      before: { open: true, right: undefined },
      focused: 0,
      revision: 'r2',
    });
    await settle();
    // Lines that came without theirs are read.
    expect(listed.get('t1')?.texts.get(0)).toBe('export interface Line {');

    closeReferences();
    expect(seen.put).toEqual([{ open: true, right: undefined }]);
    expect(seen.middle).toBe(1);
  });

  it('closes the panel on Esc when it was closed, on the threads, which it opens on next', async () => {
    seen.answers.set('references', (): References => ({
      name: 'Line',
      answers: [answer()],
      more: false,
      note: '',
    }));
    // Closed last on the references, which another `gr` showed.
    seen.kept = { open: false, right: 'code.references' };
    await references(AT);
    // Asked again while they show: focus goes to them again, and Esc still puts back the first.
    await references(AT);
    expect(seen.right).toEqual([
      { id: 'code.references', focus: true },
      { id: 'code.references', focus: true },
    ]);
    closeReferences();
    expect(seen.put).toEqual([{ open: false, right: undefined }]);
  });
});

describe('gr with every reference outside the repository', () => {
  it('says how many there are, and lists none', async () => {
    seen.answers.set('references', (): References => ({
      name: 'parse',
      answers: [],
      more: false,
      outside: 3,
    }));
    await references(AT);
    expect(said.get('t1')?.text).toBe('3 references, all outside this repo');
    expect(seen.right).toEqual([]);
  });
});

/** A hint TypeScript gives, and the mark it draws. */
const HINT = { line: 2, column: 5, label: ': string' };
const MARK = {
  kind: 'hint',
  at: { file: 'f1', side: 'new', line: 2, column: 5 },
  label: ': string',
  padding: { before: false, after: false },
};

/** The views asked for hints, each once, in the order first asked. */
function viewsAsked(): unknown[] {
  const views = seen.asked.flatMap(({ job, input }) =>
    job === 'hints' && typeof input === 'object' && input !== null && 'view' in input
      ? [input.view]
      : [],
  );
  return [...new Set(views)];
}

/** The hints view `tab`'s diff drew last, if it drew any. */
function drawnIn(tab: string): unknown {
  return seen.hints.findLast((each) => each.tab === tab && each.view === 'diff')?.hints;
}

/** View `view`'s status: of an untrusted repository, unless `trust` says otherwise. */
function statusOf(view: string, trust: Status['trust'] = { kind: 'untrusted', why: 'unnamed' }) {
  return {
    view,
    repo: 'rozed-dev/e2e',
    pull: 80,
    head: { kind: 'base' },
    trust,
    dismissed: false,
  } satisfies Status;
}

const UNTRUSTED = 'Trust the repo to see type hints';

describe('gh', () => {
  it('asks for the hints on screen, and with none says why and stays off', async () => {
    seen.answers.set('hints', (): Hints => ({ hints: [] }));
    statuses.set('t1', statusOf('t1'));
    await toggleHints();
    expect(seen.asked[0]).toMatchObject({
      job: 'hints',
      input: { view: 't1', key: HEAD, path: 'src/format.ts', from: 1, to: 9 },
    });
    expect(said.get('t1')?.text).toBe(UNTRUSTED);
    expect(hints.getState()).toEqual({ on: false, pressed: undefined });
    // Nothing came, so nothing was turned on: the next gh asks again.
    seen.asked.length = 0;
    await toggleHints();
    expect(viewsAsked()).toEqual(['t1']);
  });

  it('shows hints on the first gh once the repo is trusted', async () => {
    statuses.set('t1', statusOf('t1'));
    seen.answers.set('hints', (): Hints => ({ hints: [] }));
    await toggleHints();
    expect(said.get('t1')?.text).toBe(UNTRUSTED);
    // Trusted, and TypeScript ready.
    statuses.set('t1', statusOf('t1', { kind: 'trusted', by: 'repo' }));
    seen.answers.set('hints', (): Hints => ({ hints: [HINT], label: 'TypeScript' }));
    await toggleHints();
    expect(drawnIn('t1')).toEqual([MARK]);
    expect(hints.getState().on).toBe(true);
  });

  it('stays off, saying why, while a server starts, with one that has none, or none on screen', async () => {
    statuses.set('t1', statusOf('t1', { kind: 'trusted', by: 'repo' }));
    const cases: [Hints, string][] = [
      [
        { hints: [], label: 'TypeScript', fallback: 'TypeScript is starting' },
        'TypeScript is starting',
      ],
      [
        { hints: [], label: 'Pyright', none: 'Pyright has no type hints' },
        'Pyright has no type hints',
      ],
      [{ hints: [], label: 'TypeScript' }, 'TypeScript has no type hints for this file'],
    ];
    for (const [found, text] of cases) {
      seen.answers.set('hints', () => found);
      await toggleHints();
      expect(said.get('t1')?.text).toBe(text);
      expect(hints.getState().on).toBe(false);
      expect(drawnIn('t1')).toEqual([]);
    }
  });

  it('asks nothing before the local copy, and stays off', async () => {
    seen.local = { kind: 'fetching' };
    await toggleHints();
    expect(said.get('t1')?.text).toBe('Fetching local copy…');
    expect(seen.asked).toEqual([]);
    expect(hints.getState().on).toBe(false);
  });

  it('draws a server’s hints with the room it asks for, and takes them away again', async () => {
    seen.answers.set('hints', (): Hints => ({
      hints: [{ line: 2, column: 5, label: ': string', paddingLeft: true }],
      label: 'TypeScript',
    }));
    await toggleHints();
    expect(drawnIn('t1')).toEqual([{ ...MARK, padding: { before: true, after: false } }]);
    expect(said.get('t1')).toBeUndefined();
    await toggleHints();
    expect(drawnIn('t1')).toEqual([]);
    expect(hints.getState().on).toBe(false);
    // Saved as they came on and as they went off, so the next start has them as they were left.
    expect(seen.saved).toEqual([true, false]);
  });

  it('follows the setting: on, the code on screen asks quietly; off, they go', async () => {
    seen.answers.set('hints', (): Hints => ({ hints: [HINT], label: 'TypeScript' }));
    followHints(true);
    await settle();
    expect(hints.getState().on).toBe(true);
    expect(viewsAsked()).toEqual(['t1']);
    expect(drawnIn('t1')).toEqual([MARK]);
    followHints(false);
    expect(drawnIn('t1')).toEqual([]);
    expect(hints.getState().on).toBe(false);
    // The setting is only followed, never saved back.
    expect(seen.saved).toEqual([]);
  });

  it('once on, has each view drawn ask for its own, quietly, and goes off everywhere', async () => {
    // TypeScript reads t1's and t3's code, and Pyright t2's.
    seen.answers.set('hints', (input): Hints => {
      const view = typeof input === 'object' && input !== null && 'view' in input && input.view;
      return view === 't2'
        ? { hints: [], label: 'Pyright', none: 'Pyright has no type hints' }
        : { hints: [HINT], label: 'TypeScript' };
    });
    await toggleHints();
    expect(drawnIn('t1')).toEqual([MARK]);
    // Other tabs, or other layers of a stack, come on screen: each asks as it's drawn.
    seen.active = 't2';
    redrawn('t2');
    seen.active = 't3';
    redrawn('t3');
    await settle();
    expect(viewsAsked()).toEqual(['t1', 't2', 't3']);
    expect(said.get('t2')).toBeUndefined();
    expect(drawnIn('t2')).toEqual([]);
    expect(drawnIn('t3')).toEqual([MARK]);
    // gh again, in any view: off in every view.
    await toggleHints();
    expect([drawnIn('t1'), drawnIn('t3')]).toEqual([[], []]);
    // Off, a view drawn asks for none.
    seen.asked.length = 0;
    redrawn('t1');
    await settle();
    expect(seen.asked).toEqual([]);
  });

  it('asks again as the view is drawn anew while gh asks, and decides on that answer', async () => {
    statuses.set('t1', statusOf('t1'));
    // The first question goes unanswered: the view is drawn anew meanwhile.
    void toggleHints();
    await settle();
    expect(hints.getState()).toEqual({ on: false, pressed: 't1' });
    const first = seen.asked[0]?.signal;
    seen.answers.set('hints', (): Hints => ({ hints: [] }));
    redrawn('t1');
    await settle();
    expect(first?.aborted).toBe(true);
    expect(said.get('t1')?.text).toBe(UNTRUSTED);
    expect(hints.getState()).toEqual({ on: false, pressed: undefined });
    // So the first gh once it's trusted shows them.
    statuses.set('t1', statusOf('t1', { kind: 'trusted', by: 'repo' }));
    seen.answers.set('hints', (): Hints => ({ hints: [HINT], label: 'TypeScript' }));
    await toggleHints();
    expect(drawnIn('t1')).toEqual([MARK]);
  });

  it('stops asking in a view as it closes, and draws nothing from a late answer', async () => {
    let late: ((found: Hints) => void) | undefined;
    seen.answers.set('hints', () => new Promise<Hints>((resolve) => (late = resolve)));
    void toggleHints();
    await settle();
    const asked = seen.asked[0]?.signal;
    viewClosed('t1');
    expect(asked?.aborted).toBe(true);
    expect(hints.getState()).toEqual({ on: false, pressed: undefined });
    late?.({ hints: [HINT], label: 'TypeScript' });
    await settle();
    expect(seen.hints).toEqual([]);
    expect(said.get('t1')).toBeUndefined();
    expect(hints.getState().on).toBe(false);
    // Nor while hints are on: a view that closed while it asked draws nothing, and turning them
    // off leaves it be.
    seen.answers.set('hints', (): Hints => ({ hints: [HINT], label: 'TypeScript' }));
    await toggleHints();
    seen.answers.set('hints', () => new Promise<Hints>((resolve) => (late = resolve)));
    redrawn('t2');
    await settle();
    viewClosed('t2');
    late?.({ hints: [HINT], label: 'TypeScript' });
    await settle();
    await toggleHints();
    expect(seen.hints.filter((each) => each.tab === 't2')).toEqual([]);
  });
});

describe('K and the pointer resting', () => {
  const hover: Hover = {
    name: 'Line',
    kind: 'interface',
    text: 'export interface Line {',
    markdown: false,
    source: 'syntax',
    label: 'Code index',
    at: answer(),
  };

  it('shows the card over the word, and the next key takes it away', async () => {
    seen.answers.set('hover', () => hover);
    await typeOf(AT);
    expect(hovers.getState()).toMatchObject({ anchor: { left: 10, bottom: 40 }, hover });
    window.dispatchEvent(new Event(KEY_EVENT));
    expect(hovers.getState()).toBeUndefined();
  });

  it('shows a server’s Markdown as it was read, and takes one with nothing to draw as none', async () => {
    const text = 'The **input**, a line at a time.';
    const read: Hover = {
      name: 'Line',
      kind: undefined,
      text,
      markdown: true,
      tree: markdownTree(text, { breaks: false }),
      source: 'server',
      label: 'TypeScript',
    };
    seen.answers.set('hover', () => read);
    await typeOf(AT);
    expect(hovers.getState()?.hover).toBe(read);
    window.dispatchEvent(new Event(KEY_EVENT));
    seen.answers.set('hover', (): Hover => ({ ...read, tree: undefined }));
    await typeOf(AT);
    expect(hovers.getState()).toBeUndefined();
    expect(said.get('t1')?.text).toBe('No type for this name');
  });

  it('says so when K finds nothing, but a rest that finds nothing says nothing', async () => {
    seen.answers.set('hover', () => ({ none: true }));
    await typeOf(AT);
    expect(said.get('t1')?.text).toBe('No type for this name');
    // Why the server didn't answer, when one could have, is on its own status item, not here.
    seen.answers.set('hover', () => ({ none: true, fallback: 'TypeScript is starting' }));
    await typeOf(AT);
    expect(said.get('t1')?.text).toBe('No type for this name');
    said.set('t1', undefined);
    rested('t1', 'diff', PLACE);
    await settle();
    expect(said.get('t1')).toBeUndefined();
  });

  it('shows no card when the reader presses a key while K asks', async () => {
    let answerHover: ((found: Hover) => void) | undefined;
    seen.answers.set('hover', () => new Promise<Hover>((resolve) => (answerHover = resolve)));
    const asked = typeOf(AT);
    await settle();
    window.dispatchEvent(new Event(KEY_EVENT));
    expect(seen.asked.at(-1)?.signal?.aborted).toBe(true);
    answerHover?.(hover);
    await asked;
    expect(hovers.getState()).toBeUndefined();
  });

  it('cancels the question before as the pointer rests elsewhere, and closes as it leaves', async () => {
    rested('t1', 'diff', { file: 'f1', side: 'new', line: 1, column: 3 });
    rested('t1', 'diff', { file: 'f1', side: 'new', line: 1, column: 14 });
    expect(seen.asked.map((each) => each.signal?.aborted)).toEqual([true, false]);
    seen.answers.set('hover', () => hover);
    rested('t1', 'diff', { file: 'f1', side: 'new', line: 2, column: 0 });
    await settle();
    expect(hovers.getState()).toBeDefined();
    rested('t1', 'diff', undefined);
    expect(hovers.getState()).toBeUndefined();
  });
});

describe('gO', () => {
  it('shows the symbols as they come, found by what was typed while they were on their way', async () => {
    let answerOutline: ((found: Outline) => void) | undefined;
    seen.answers.set('outline', () => new Promise<Outline>((resolve) => (answerOutline = resolve)));
    const asked = outline(AT);
    await settle();
    typeOutline('form');
    answerOutline?.({
      symbols: [{ name: 'format', kind: 'function', line: 6, column: 16, lastLine: 8 }],
      more: false,
      source: 'syntax',
    });
    await asked;
    expect(outlines.getState()).toMatchObject({
      open: true,
      query: 'form',
      outline: { symbols: [{ name: 'format' }] },
    });
  });
});
