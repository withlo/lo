// @vitest-environment jsdom
// The glossary terms the reader ignores, from `overview.ignored`: which a repo's overview draws as
// plain text, whether each of a term's switches is on, and turning one, with the toast that says
// so and its Undo.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { notice, notices } from '../../../window/commands/notices.tsx';
import type { Setting } from '../../settings/contract.ts';
import type { ScopedValue } from '../settings.ts';
import type { TermNames } from './definitions.ts';
import { ignoredKeys, ignoring, isIgnored, stopIgnoring, turnIgnored } from './ignored.ts';

/** Whether main saves what's asked of it. */
const main = vi.hoisted(() => ({ saves: true }));

// The setting as this window shows it: what was last saved, as main says it back.
vi.mock(import('../../settings/window/shared.ts'), async (original) => ({
  ...(await original()),
  shownAtOnce: <T>(setting: Setting<T>) => {
    let value = setting.fallback;
    return {
      change: (next: T) => {
        if (main.saves) value = next;
        return Promise.resolve(main.saves);
      },
      useShown: () => value,
      shownNow: () => value,
    };
  },
}));

/** Main saying the setting is `value`, as it does once it's saved it. */
function mainSays(value: ScopedValue): void {
  void ignoring.change(value);
}

afterEach(() => {
  main.saves = true;
  mainSays({});
});

/** The setting as the overview shows it now. */
const shown = (): ScopedValue => ignoring.shownNow();

const REPO = 'rozed-dev/e2e';
const BUCKET: TermNames = { name: 'Bucket', also: ['buckets'] };

/** Lets what main's answer runs, run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the terms ignored in a repo', () => {
  it('are the entries of its list, or of every repo’s where it has none, as their keys', () => {
    const value = { '*': ['Token  Bucket'], 'fieldwork/atlas-api': ['Lease'] };
    expect([...ignoredKeys(value, REPO)]).toEqual(['token bucket']);
    expect([...ignoredKeys(value, 'Fieldwork/Atlas-API')]).toEqual(['lease']);
  });
});

describe('a term’s switches', () => {
  it('are on in this repo by the list that applies there, by any name it goes by', () => {
    expect(isIgnored({ '*': ['BUCKETS'] }, 'repo', REPO, BUCKET)).toBe(true);
    expect(isIgnored({ '*': ['buckets'], [REPO]: [] }, 'repo', REPO, BUCKET)).toBe(false);
  });

  it('are on in every repo only while every list has it', () => {
    expect(isIgnored({ '*': ['Bucket'] }, 'every', REPO, BUCKET)).toBe(true);
    expect(isIgnored({ '*': ['Bucket'], [REPO]: ['Lease'] }, 'every', REPO, BUCKET)).toBe(false);
    expect(isIgnored({ [REPO]: ['Bucket'] }, 'every', REPO, BUCKET)).toBe(false);
  });
});

describe('turning one', () => {
  it('on, ignores the term and says so once it’s saved, with Undo, which puts it back', async () => {
    mainSays({ '*': ['Lease'] });
    turnIgnored(REPO, BUCKET, 'repo');
    expect(shown()).toEqual({ '*': ['Lease'], [REPO]: ['Lease', 'Bucket'] });
    await settled();
    expect(notice()).toMatchObject({ title: 'Ignored Bucket in rozed-dev/e2e', done: true });
    notice()?.action?.onClick();
    expect(shown()).toEqual({ '*': ['Lease'] });
  });

  it('in every repo, says so; its Undo takes out only what it put in, where the setting changed since', async () => {
    mainSays({ [REPO]: ['Lease'] });
    turnIgnored(REPO, BUCKET, 'every');
    expect(shown()).toEqual({ '*': ['Bucket'], [REPO]: ['Lease', 'Bucket'] });
    await settled();
    expect(notice()?.title).toBe('Ignored Bucket in every repo');
    mainSays({ '*': ['Bucket', 'Quota'], [REPO]: ['Lease', 'Bucket'] });
    notice()?.action?.onClick();
    expect(shown()).toEqual({ '*': ['Quota'], [REPO]: ['Lease'] });
  });

  it('off, shows the term again, with nothing said; and nothing is said of what isn’t saved', async () => {
    mainSays({ '*': ['buckets'] });
    const before = notices();
    turnIgnored(REPO, BUCKET, 'repo');
    expect(shown()).toEqual({ '*': ['buckets'], [REPO]: [] });
    await settled();
    expect(notices()).toEqual(before);

    // Refused, it's as main has it, and only the refusal is said.
    main.saves = false;
    turnIgnored('fieldwork/atlas-api', { name: 'Lease', also: [] }, 'repo');
    await settled();
    expect(shown()).toEqual({ '*': ['buckets'], [REPO]: [] });
    expect(notices().map((each) => each.title)).not.toContain(
      'Ignored Lease in fieldwork/atlas-api',
    );
  });
});

/** Presses Undo on the newest toast that says `title`. */
function undo(title: string): void {
  notices()
    .findLast((each) => each.title === title)
    ?.action?.onClick();
}

describe('Undo, after the setting changed since', () => {
  it('takes the term out only of the lists that gained it', async () => {
    mainSays({ '*': ['Bucket'], [REPO]: ['Lease'], 'a/b': ['Bucket'] });
    turnIgnored(REPO, BUCKET, 'every');
    await settled();
    turnIgnored(REPO, { name: 'Quota', also: [] }, 'repo');
    await settled();
    undo('Ignored Bucket in every repo');
    expect(shown()).toEqual({ '*': ['Bucket'], [REPO]: ['Lease', 'Quota'], 'a/b': ['Bucket'] });
  });

  it('takes away a repo’s own list it made, so the repo follows every repo’s again', async () => {
    mainSays({ '*': ['Lease'] });
    turnIgnored(REPO, BUCKET, 'repo');
    await settled();
    expect(shown()).toEqual({ '*': ['Lease'], [REPO]: ['Lease', 'Bucket'] });
    mainSays({ '*': ['Lease', 'Quota'], [REPO]: ['Lease', 'Bucket'] });
    undo('Ignored Bucket in rozed-dev/e2e');
    expect(shown()).toEqual({ '*': ['Lease', 'Quota'] });
  });

  it('keeps a list it made that’s changed since, without the term', async () => {
    mainSays({ '*': ['Lease'] });
    turnIgnored(REPO, BUCKET, 'repo');
    await settled();
    turnIgnored(REPO, { name: 'Quota', also: [] }, 'repo');
    await settled();
    undo('Ignored Bucket in rozed-dev/e2e');
    expect(shown()).toEqual({ '*': ['Lease'], [REPO]: ['Lease', 'Quota'] });
  });

  it('takes away a repo’s own list it leaves the same as every repo’s, in this repo', async () => {
    mainSays({ '*': ['Lease'] });
    turnIgnored(REPO, BUCKET, 'repo');
    await settled();
    turnIgnored(REPO, { name: 'Quota', also: [] }, 'repo');
    await settled();
    // Oldest first: the second's Undo leaves the repo's list as every repo's.
    undo('Ignored Bucket in rozed-dev/e2e');
    undo('Ignored Quota in rozed-dev/e2e');
    expect(shown()).toEqual({ '*': ['Lease'] });
  });
});

describe('a term with a long name', () => {
  it('is ignored as any other, and said so, up to the most bytes a term may be', async () => {
    // 1,024 bytes of UTF-8, the most a term may be.
    const long: TermNames = { name: `${'é'.repeat(500)}${'a'.repeat(24)}`, also: [] };
    turnIgnored(REPO, long, 'repo');
    await settled();
    expect(shown()).toEqual({ [REPO]: [long.name] });
    expect(isIgnored(shown(), 'repo', REPO, long)).toBe(true);
    expect(notice()?.title).toBe(`Ignored ${long.name} in rozed-dev/e2e`);
    turnIgnored(REPO, long, 'every');
    expect(isIgnored(shown(), 'every', REPO, long)).toBe(true);
    expect(shown()).toEqual({ '*': [long.name], [REPO]: [long.name] });
  });
});

describe('“Stop ignoring”', () => {
  it('takes the term out of every list, by any name it goes by', () => {
    mainSays({ '*': ['Bucket'], [REPO]: ['buckets', 'Lease'], 'fieldwork/atlas-api': ['Bucket'] });
    stopIgnoring(REPO, BUCKET);
    expect(shown()).toEqual({ '*': [], [REPO]: ['Lease'], 'fieldwork/atlas-api': [] });
  });

  it('turns off both switches, the repo’s own list going once it’s every repo’s', () => {
    mainSays({ [REPO]: ['Bucket'] });
    stopIgnoring(REPO, BUCKET);
    expect(shown()).toEqual({ '*': [] });
    expect(isIgnored(shown(), 'repo', REPO, BUCKET)).toBe(false);
    mainSays({ '*': ['Lease'], [REPO]: ['Lease', 'Bucket'] });
    stopIgnoring(REPO, BUCKET);
    expect(shown()).toEqual({ '*': ['Lease'] });
  });
});
