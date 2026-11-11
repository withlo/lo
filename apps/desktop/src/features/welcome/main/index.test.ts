import { describe, expect, it, vi } from 'vitest';

import type { FeatureContext } from '../../../main/features.ts';
import type { LocalGit } from '../../../main/git.ts';
import { contract } from '../contract.ts';
import feature from './index.ts';

/** Main's context for a handler, with the git it is given and nothing else. */
function contextWith(git: Pick<LocalGit, 'check'>): FeatureContext<typeof contract> {
  const context: Partial<FeatureContext<typeof contract>> = { git: { ...stub, ...git } };
  return Object.assign(Object.create(null), context);
}

/** The parts of git the handler doesn't touch. */
const stub: Omit<LocalGit, 'check'> = {
  status: undefined,
  cache: undefined,
  onStatus: () => undefined,
  onCache: () => () => undefined,
  setCap: () => Promise.resolve(),
};

describe('welcome.checkGit', () => {
  it('has a handler for every request in its contract, and no other', () => {
    expect(Object.keys(feature.handlers)).toEqual(Object.keys(contract.requests));
  });

  it('looks for git again, and answers once it has looked', async () => {
    let looking = false;
    const check = vi.fn<LocalGit['check']>(async () => {
      looking = true;
      await Promise.resolve();
      looking = false;
      return { status: 'missing', message: "Lo can't find git.", install: 'Install git.' };
    });
    const answered = feature.handlers['checkGit']?.(undefined, contextWith({ check }));
    expect(check).toHaveBeenCalledOnce();
    expect(looking).toBe(true);
    expect(await answered).toBeUndefined();
    expect(looking).toBe(false);
  });

  it('fails when git has stopped, as Lo quits, for main to log', async () => {
    const check = vi.fn<LocalGit['check']>(() => Promise.reject(new Error('git has stopped')));
    await expect(
      Promise.resolve(feature.handlers['checkGit']?.(undefined, contextWith({ check }))),
    ).rejects.toThrow('git has stopped');
  });
});
