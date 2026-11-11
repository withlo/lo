import {
  checkClashes,
  checkHandlers,
  checkIds,
  checkKeys,
  checkMenus,
  checkVim,
  defineCommands,
  type Declarations,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import { featureCommands } from '../features.ts';
import { checkDeclarations } from './declarations.ts';

// Every feature's keys.ts, found as the script that writes docs/keys.md finds them, and the
// commands the window's features give the registry.
const features = checkDeclarations(
  import.meta.glob<Declarations>('../../features/*/keys.ts', { eager: true, import: 'default' }),
);
const given = featureCommands();

describe("every feature's commands", () => {
  it('are found', () => {
    expect(features.map((each) => each.feature)).toContain('keys');
  });

  it('have ids of their own, and name only scopes that exist', () => {
    expect(checkIds(features)).toEqual([]);
  });

  it('have one handler each, and no handler lacks a declaration', () => {
    expect(checkHandlers(features, given)).toEqual([]);
  });

  it('have a default key on each system they’re on', () => {
    expect(checkKeys(features)).toEqual([]);
  });

  it('have a key for every menu item', () => {
    expect(checkMenus(features)).toEqual([]);
  });

  it('claim no key or start of a sequence twice, in any scope, mode or system', () => {
    expect(checkClashes(features)).toEqual([]);
  });

  it('take none of Vim’s keys in code views unless they say overVim', () => {
    expect(checkVim(features)).toEqual([]);
  });
});

describe('the declarations', () => {
  const keys = defineCommands('keys', {});

  it('are each feature’s, under its own folder’s name, in the folders’ order', () => {
    const tree = defineCommands('tree', {});
    expect(
      checkDeclarations({
        '../../features/tree/keys.ts': tree,
        '../../features/keys/keys.ts': keys,
      }),
    ).toEqual([keys, tree]);
    expect(() => checkDeclarations({ '/lo/src/features/tree/keys.ts': keys })).toThrow(
      '/lo/src/features/tree/keys.ts declares the feature keys, but its folder is "tree".',
    );
  });
});
