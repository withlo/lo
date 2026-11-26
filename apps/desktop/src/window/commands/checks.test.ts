import {
  checkBar,
  checkClashes,
  checkEditingKeys,
  checkHandlers,
  checkIds,
  checkKeys,
  checkMenus,
  checkRoutes,
  checkToggles,
  checkVim,
  commandsOf,
  defineCommands,
  type Declarations,
} from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import { barNames } from '../../platform/menu.ts';
import { featureCommands } from '../features.ts';
import { checkDeclarations } from './declarations.ts';
import { FIELDLESS, LEFT_TO_FIELDS } from './fieldless.ts';
import { WITHOUT_ROUTE } from './routes.ts';

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

  it('leave the keys that edit text to fields, but where no field is or they edit it', () => {
    expect(checkEditingKeys(features, FIELDLESS, LEFT_TO_FIELDS)).toEqual([]);
  });

  it('have a key for every menu item', () => {
    expect(checkMenus(features)).toEqual([]);
  });

  it('each name how the mouse reaches them, but those listed as waiting for a control', () => {
    expect(checkRoutes(features, WITHOUT_ROUTE)).toEqual([]);
  });

  it('wait for a control no more than before: the list only shrinks', () => {
    // Lowered as commands come off the list, so that none can join it.
    expect(WITHOUT_ROUTE.length).toBeLessThanOrEqual(21);
    expect(new Set(WITHOUT_ROUTE).size).toBe(WITHOUT_ROUTE.length);
  });

  it('join only the app menu’s menus and sections, by their names', () => {
    expect(checkBar(features, barNames())).toEqual([]);
  });

  it('say when they’re checked, each switch and choice, and nothing else does', () => {
    expect(checkToggles(features, given)).toEqual([]);
  });

  it('put each choice in a section of the app menu of its own, the one choice it holds', () => {
    // Electron makes one choice of every radio item between two separators, so two choices in a
    // section would check one item of the two. A new choice fails this until it's listed, in a
    // section of its own.
    const sections = new Map<string, string[]>();
    for (const command of features.flatMap(commandsOf)) {
      if (command.toggle !== 'choice' || !command.bar) continue;
      const at = `${command.bar.menu} ${command.bar.section}`;
      sections.set(at, [...(sections.get(at) ?? []), command.id].toSorted());
    }
    expect(Object.fromEntries(sections)).toEqual({
      // The pull request's view.
      'View views': ['diff.show', 'overview.show', 'timeline.show'],
      // The diff's layout.
      'View diff': ['diff.inline', 'diff.sideBySide'],
      // How review threads show in code.
      'View threads': ['comments.threadsBeside', 'comments.threadsBetween'],
    });
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
