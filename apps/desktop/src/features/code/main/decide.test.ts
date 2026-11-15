// The decision, on what GitHub recorded of rozed-dev/e2e's pull requests: #80 from a branch of its
// own, #97 from a fork, rozed-bot/e2e, and #96 from a fork that was deleted.

import {
  GithubClient,
  PullRef,
  readPullRequestRepositories,
  Token,
  type PullRequestRepositories,
} from '@lo/github';
import { replayFetch } from '@lo/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PullEntry, RepoEntry } from '../settings.ts';
import { decide, naming, needsRead, type DecidedView, type Read } from './decide.ts';

const E2E = 'R_kgDOVleUfQ';
const FORK = 'R_kgDOVvlr6A';

let read: Record<80 | 96 | 97, Read>;

beforeAll(async () => {
  const github = new GithubClient({
    fetch: replayFetch('pull_request_repositories_e2e'),
    token: new Token('gho_FAKE'),
  });
  const of = async (number: number): Promise<Read> => ({
    kind: 'read',
    repositories: await readPullRequestRepositories(
      github,
      new PullRef('rozed-dev', 'e2e', number),
    ),
  });
  read = { 80: await of(80), 96: await of(96), 97: await of(97) };
});

/** A view of rozed-dev/e2e's pull request `number`, its local copy ready, with `change`. */
function view(number: number, change: Partial<DecidedView> = {}): DecidedView {
  return { repo: 'rozed-dev/e2e', number, noGit: false, local: true, fork: null, ...change };
}

const repoEntry = (change: Partial<Omit<RepoEntry, 'kind'>> = {}): RepoEntry => ({
  kind: 'repo',
  repo: 'rozed-dev/e2e',
  id: E2E,
  ...change,
});

const pullEntry = (pull: number, change: Partial<Omit<PullEntry, 'kind'>> = {}): PullEntry => ({
  kind: 'pull',
  repo: 'rozed-dev/e2e',
  id: E2E,
  pull,
  from: 'rozed-bot/e2e',
  fromId: FORK,
  ...change,
});

describe('the decision', () => {
  it('trusts a pull request from a branch of its own repository, by the repository’s entry', () => {
    const entry = repoEntry();
    expect(decide(view(80), [entry], read[80])).toEqual({
      trust: { kind: 'trusted', by: 'repo' },
      by: entry,
      head: { kind: 'base' },
    });
    // Names in any case, as GitHub's.
    expect(decide(view(80), [repoEntry({ repo: 'Rozed-Dev/E2E' })], read[80]).trust.kind).toBe(
      'trusted',
    );
  });

  it('trusts a fork’s pull request only by its own entry, never by the repository’s', () => {
    const fork = view(97, { fork: 'rozed-bot/e2e' });
    expect(decide(fork, [repoEntry()], read[97]).trust).toEqual({
      kind: 'untrusted',
      why: 'other',
    });
    expect(decide(fork, [repoEntry(), pullEntry(97)], read[97]).trust).toEqual({
      kind: 'trusted',
      by: 'pull',
    });
    // Another pull request's entry, or one from another fork, trusts nothing here.
    expect(decide(fork, [pullEntry(98)], read[97]).trust.kind).toBe('untrusted');
    expect(decide(fork, [pullEntry(97, { fromId: 'R_other' })], read[97]).trust.kind).toBe(
      'untrusted',
    );
  });

  it('asks again about a fork that moved to another owner, or was renamed, since it was trusted', () => {
    const fork = view(97, { fork: 'rozed-bot/e2e' });
    // The entry named the fork as it was; GitHub says rozed-bot/e2e now, with the same ID.
    for (const from of ['someone-else/e2e', 'rozed-bot/e2e-old']) {
      expect(decide(fork, [pullEntry(97, { from })], read[97]).trust).toEqual({
        kind: 'untrusted',
        why: 'other',
      });
    }
    expect(decide(fork, [pullEntry(97, { from: 'Rozed-Bot/E2E' })], read[97]).trust).toEqual({
      kind: 'trusted',
      by: 'pull',
    });
  });

  it('counts a pull request whose fork is gone as a fork, which no entry can trust', () => {
    // The tab can't tell it from a branch of the repository's own.
    const gone = view(96, { fork: null });
    const decided = decide(gone, [repoEntry(), pullEntry(96)], read[96]);
    expect(decided.trust).toEqual({ kind: 'untrusted', why: 'other' });
    expect(decided.head).toEqual({ kind: 'gone' });
  });

  it('trusts no repository that has the name but isn’t the one trusted', () => {
    // As when a deleted account's name is taken, and a repository made under it.
    expect(decide(view(80), [repoEntry({ id: 'R_kgDOsomeoneElse' })], read[80]).trust).toEqual({
      kind: 'untrusted',
      why: 'other',
    });
    expect(
      decide(view(97, { fork: 'rozed-bot/e2e' }), [pullEntry(97, { id: 'R_x' })], read[97]),
    ).toMatchObject({ trust: { kind: 'untrusted', why: 'other' } });
  });

  it('asks again about a repository renamed since it was trusted, reading nothing', () => {
    // The tab has the name GitHub gives it now.
    const renamed = view(80, { repo: 'rozed-dev/e2e-renamed' });
    const entries = [repoEntry()];
    expect(naming(renamed, entries)).toEqual([]);
    expect(needsRead(renamed, entries)).toBe(false);
    expect(decide(renamed, entries, undefined).trust).toEqual({
      kind: 'untrusted',
      why: 'unnamed',
    });
  });

  it('reads nothing for a repository no entry names, and is untrusted at once', () => {
    const entries = [repoEntry({ repo: 'rozed-dev/other' }), pullEntry(97)];
    expect(needsRead(view(80), entries)).toBe(false);
    expect(decide(view(80), entries, undefined).trust).toEqual({
      kind: 'untrusted',
      why: 'unnamed',
    });
    // Nor with the local copy still to come, or the settings file still to be read.
    expect(decide(view(80, { local: false }), entries, undefined).trust.kind).toBe('untrusted');
    expect(decide(view(80), undefined, undefined).trust.kind).toBe('checking');
  });

  it('runs nothing without git, or before the local copy, and reads the IDs only then', () => {
    const entries = [repoEntry()];
    // Nor before Lo has looked for git, whether or not an entry names the view.
    expect(decide(view(80, { noGit: undefined }), [], undefined).trust).toEqual({
      kind: 'checking',
    });
    expect(needsRead(view(80, { noGit: undefined }), entries)).toBe(false);
    expect(decide(view(80, { noGit: true }), entries, read[80]).trust).toEqual({ kind: 'noGit' });
    expect(needsRead(view(80, { noGit: true }), entries)).toBe(false);
    expect(decide(view(80, { local: false }), entries, undefined).trust).toEqual({
      kind: 'waiting',
    });
    expect(needsRead(view(80, { local: false }), entries)).toBe(false);
    expect(needsRead(view(80), entries)).toBe(true);
    // Nor before GitHub has said where the head is.
    expect(needsRead(view(80, { fork: undefined }), entries)).toBe(false);
    expect(decide(view(80, { fork: undefined }), entries, undefined).trust.kind).toBe('checking');
  });

  it('is untrusted until the IDs are read, and while a read fails', () => {
    const entries = [repoEntry()];
    expect(decide(view(80), entries, undefined).trust).toEqual({ kind: 'checking' });
    const failed: Read = { kind: 'failed', message: 'GitHub is down.' };
    expect(decide(view(80), entries, failed).trust).toEqual({
      kind: 'untrusted',
      why: 'unread',
      message: 'GitHub is down.',
    });
  });

  it('decides each layer of a stack by its own pull request', () => {
    // A trusted repository's layers: one from a branch of its own, one from a fork.
    const entries = [repoEntry()];
    const own = decide(view(80), entries, read[80]);
    const fork = decide(view(97, { fork: 'rozed-bot/e2e' }), entries, read[97]);
    expect([own.trust.kind, fork.trust.kind]).toEqual(['trusted', 'untrusted']);
    // A run of layers is a view of its top layer, and decides as it does.
    expect(decide(view(97, { fork: 'rozed-bot/e2e' }), [pullEntry(97)], read[97]).trust.kind).toBe(
      'trusted',
    );
  });

  it('takes where the head is from the tab until the IDs are read', () => {
    const repositories: PullRequestRepositories = {
      base: { id: E2E, name: 'rozed-dev/e2e' },
      head: { id: FORK, name: 'rozed-bot/e2e' },
      isCrossRepository: true,
    };
    expect(decide(view(97, { fork: 'rozed-bot/e2e' }), [], undefined).head).toEqual({
      kind: 'fork',
      repo: 'rozed-bot/e2e',
    });
    expect(decide(view(97), [repoEntry()], { kind: 'read', repositories }).head).toEqual({
      kind: 'fork',
      repo: 'rozed-bot/e2e',
    });
    expect(decide(view(97, { fork: undefined }), [], undefined).head).toBeNull();
  });
});
