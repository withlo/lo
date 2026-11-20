import { describe, expect, it, vi } from 'vitest';

import { buildCommit } from './commit.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('buildCommit', () => {
  it('is the commit a workflow says it runs on, without asking git', () => {
    const git = vi.fn<(cwd: string) => string>(() => OTHER);
    expect(buildCommit({ GITHUB_SHA: SHA }, '/repo', git)).toBe(SHA);
    expect(buildCommit({ GITHUB_SHA: ` ${SHA.toUpperCase()}\n` }, '/repo', git)).toBe(SHA);
    expect(git).not.toHaveBeenCalled();
  });

  it("is what git says in the checkout when there's no workflow", () => {
    const git = vi.fn<(cwd: string) => string>(() => `${OTHER}\n`);
    expect(buildCommit({}, '/repo', git)).toBe(OTHER);
    expect(git).toHaveBeenCalledWith('/repo');
    // SHA-256 repositories name commits with 64 digits.
    expect(buildCommit({}, '/repo', () => 'c'.repeat(64))).toBe('c'.repeat(64));
  });

  it('ignores a GITHUB_SHA that is not a hash', () => {
    for (const GITHUB_SHA of ['', 'main', SHA.slice(1), `${SHA}0`, 'g'.repeat(40)]) {
      expect(buildCommit({ GITHUB_SHA }, '/repo', () => OTHER)).toBe(OTHER);
    }
  });

  it("is empty where git can't say: no checkout, no git, or an answer that isn't a hash", () => {
    expect(
      buildCommit({}, '/repo', () => {
        throw new Error('not a git repository');
      }),
    ).toBe('');
    expect(buildCommit({}, '/repo', () => 'HEAD')).toBe('');
    expect(buildCommit({}, '/repo', () => '')).toBe('');
  });
});
