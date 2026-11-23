import { describe, expect, it, vi } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import type { Caller, FeatureContext } from '../../../main/features.ts';
import type { LocalGit } from '../../../main/git.ts';
import { migrate } from '../../../main/migrations.ts';
import { contract } from '../contract.ts';
import feature from './index.ts';

/** Main's context for a handler, with the git it is given and nothing else. */
function contextWith(git: Pick<LocalGit, 'check'>): FeatureContext<typeof contract> {
  const context: Partial<FeatureContext<typeof contract>> = { git: { ...stub, ...git } };
  return Object.assign(Object.create(null), context);
}

/** The parts of git the handler doesn't touch. */
/** A request from no window in particular. */
const NO_WINDOW: Caller = { windowId: undefined };

const stub: Omit<LocalGit, 'check'> = {
  status: undefined,
  cache: undefined,
  onStatus: () => undefined,
  onCache: () => () => undefined,
  setCap: () => Promise.resolve(),
};

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/welcome/'), sql]),
);

/** Main's context for a handler, with a database that has the feature's tables and nothing else. */
function contextOn(database: Database): FeatureContext<typeof contract> {
  const context: Partial<FeatureContext<typeof contract>> = { database };
  return Object.assign(Object.create(null), context);
}

describe('welcome', () => {
  it('has a handler for every request in its contract, and no other', () => {
    expect(Object.keys(feature.handlers)).toEqual(Object.keys(contract.requests));
  });

  it('keeps that the welcome was finished, for a Lo started again, and keeps the first time', () => {
    const database = openDatabase(':memory:');
    migrate(database, migrations);
    const context = contextOn(database);
    expect(feature.handlers['state']?.(undefined, context, NO_WINDOW)).toEqual({ finished: false });
    feature.handlers['finish']?.(undefined, context, NO_WINDOW);
    const [first] = database.prepare('SELECT at FROM welcome_finished').all();
    feature.handlers['finish']?.(undefined, context, NO_WINDOW);
    expect(feature.handlers['state']?.(undefined, context, NO_WINDOW)).toEqual({ finished: true });
    expect(database.prepare('SELECT at FROM welcome_finished').all()).toEqual([first]);
    database.close();
  });
});

describe('welcome.checkGit', () => {
  it('looks for git again, and answers once it has looked', async () => {
    let looking = false;
    const check = vi.fn<LocalGit['check']>(async () => {
      looking = true;
      await Promise.resolve();
      looking = false;
      return { status: 'missing', install: { commands: ['xcode-select --install'] } };
    });
    const answered = feature.handlers['checkGit']?.(undefined, contextWith({ check }), NO_WINDOW);
    expect(check).toHaveBeenCalledOnce();
    expect(looking).toBe(true);
    expect(await answered).toBeUndefined();
    expect(looking).toBe(false);
  });

  it('fails when git has stopped, as Lo quits, for main to log', async () => {
    const check = vi.fn<LocalGit['check']>(() => Promise.reject(new Error('git has stopped')));
    await expect(
      Promise.resolve(feature.handlers['checkGit']?.(undefined, contextWith({ check }), NO_WINDOW)),
    ).rejects.toThrow('git has stopped');
  });
});
