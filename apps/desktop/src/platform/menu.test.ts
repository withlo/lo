import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import type { BarItem } from '../features/keys/contract.ts';
import { acceleratorOf, appMenu, barNames, menuTree, type MenuOptions } from './menu.ts';

/** A command in the app menu, enabled, with no key. */
const item = (
  id: string,
  menu: string,
  section: string,
  order: number,
  more: Partial<BarItem> = {},
) => ({ id, label: id, menu, section, order, enabled: true, ...more }) satisfies BarItem;

const items: BarItem[] = [
  item('keys.forward', 'Go', 'history', 20, {
    label: 'Forward',
    key: { key: 'i', meta: false, ctrl: true, alt: false, shift: false },
  }),
  item('keys.back', 'Go', 'history', 10, {
    label: 'Back',
    key: { key: 'o', meta: false, ctrl: true, alt: false, shift: false },
    enabled: false,
  }),
  item('diff.inline', 'View', 'diff', 5, { label: 'Inline' }),
];

const options: MenuOptions = {
  name: 'Lo',
  devTools: false,
  run: () => undefined,
  redraw: () => undefined,
};

/** Clicks `on`, by its key or not, as Electron would. */
const clickOn = (on: MenuItemConstructorOptions | undefined, triggeredByAccelerator: boolean) =>
  on?.click?.(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the event is read.
    {} as Parameters<NonNullable<MenuItemConstructorOptions['click']>>[0],
    undefined,
    { triggeredByAccelerator, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
  );

function menuOf(template: MenuItemConstructorOptions[], label: string) {
  const found = template.find((each) => each.label === label);
  return Array.isArray(found?.submenu) ? found.submenu : undefined;
}

/** A menu's items by id, role or type. */
const partsOf = (template: MenuItemConstructorOptions[], label: string) =>
  menuOf(template, label)?.map((each) => each.id ?? each.role ?? each.type);

/** Every role and accelerator in a template, however deep. */
function everything(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((each) => [
    ...(each.role ? [`role:${each.role}`] : []),
    ...(typeof each.accelerator === 'string' ? [`key:${each.accelerator}`] : []),
    ...(Array.isArray(each.submenu) ? everything(each.submenu) : []),
  ]);
}

/** The item in the app section of Lo's menu, with Restart to update `enabled` or not. */
const updateItem = (enabled: boolean) =>
  partsOf(
    menuTree(
      'mac',
      [
        item('updates.check', 'Lo', 'app', 10),
        item('updates.restart', 'Lo', 'app', 10, { instead: 'updates.check', enabled }),
      ],
      options,
    ),
    'Lo',
  )?.slice(2, 3);

/** A template's menus, each by label and role. */
const topOf = (menus: MenuItemConstructorOptions[]) => menus.map((each) => [each.label, each.role]);

describe('the app menu', () => {
  const run: string[] = [];
  const template = menuTree('mac', items, { ...options, run: (id) => run.push(id) });

  it('never reloads the page or closes the window by key', () => {
    for (const system of ['mac', 'linux'] as const) {
      const all = everything(menuTree(system, items, options));
      for (const missing of ['role:reload', 'role:forceReload', 'role:close']) {
        expect(all).not.toContain(missing);
      }
      expect(all.filter((each) => /\+[RW]$/.test(each))).toEqual([]);
    }
  });

  it('keeps the menus in their order, leaving out those with nothing in them', () => {
    expect(template.map((each) => each.label)).toEqual(['Lo', 'Edit', 'View', 'Go', 'Window']);
    expect(barNames().map(({ menu }) => menu)).toEqual([
      'Lo',
      'File',
      'Edit',
      'View',
      'Go',
      'Review',
      'Window',
      'Help',
    ]);
    expect(barNames().find(({ menu }) => menu === 'File')?.sections).toEqual([
      'open',
      'pull',
      'tab',
      'quit',
    ]);
  });

  it("keeps macOS's roles: the app's menu, editing and the window", () => {
    expect(partsOf(template, 'Lo')).toEqual([
      'about',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    expect(partsOf(template, 'Edit')).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    expect(template.at(-1)).toMatchObject({ label: 'Window', role: 'windowMenu' });
    expect(partsOf(template, 'Window')).toEqual(['minimize', 'zoom', 'separator', 'front']);
  });

  it("puts Lo's commands in their sections, in order, with their keys and states", () => {
    expect(
      menuOf(template, 'Go')?.map((each) => [each.id, each.label, each.accelerator, each.enabled]),
    ).toEqual([
      ['keys.back', 'Back', 'Control+O', false],
      ['keys.forward', 'Forward', 'Control+I', true],
    ]);
    expect(partsOf(template, 'View')).toEqual(['diff.inline', 'separator', 'togglefullscreen']);
    const help = menuTree('mac', [item('welcome.show', 'Help', 'help', 10)], options);
    expect(help.at(-1)).toMatchObject({ label: 'Help', role: 'help' });
  });

  it('puts Settings in the app’s own menu, with the system’s …, after About', () => {
    const lo = partsOf(
      menuTree(
        'mac',
        [
          item('settings.open', 'Lo', 'app', 20, { label: 'Settings' }),
          item('updates.check', 'Lo', 'app', 10),
        ],
        options,
      ),
      'Lo',
    );
    expect(lo?.slice(0, 5)).toEqual([
      'about',
      'separator',
      'updates.check',
      'settings.open',
      'separator',
    ]);
    const settings = menuOf(
      menuTree('mac', [item('settings.open', 'Lo', 'app', 20, { label: 'Settings' })], options),
      'Lo',
    )?.find((each) => each.id === 'settings.open');
    expect(settings?.label).toBe('Settings…');
  });

  it('shows a command in place of another while it can run, and not otherwise', () => {
    expect(updateItem(true)).toEqual(['updates.restart']);
    expect(updateItem(false)).toEqual(['updates.check']);
  });

  it('draws a switch as a check box and a choice as a radio item, each with its state', () => {
    const view = menuOf(
      menuTree(
        'mac',
        [
          item('tab.rightPanel', 'View', 'panels', 10, { toggle: 'switch', checked: true }),
          item('diff.sideBySide', 'View', 'diff', 10, { toggle: 'choice', checked: false }),
          item('diff.inline', 'View', 'diff', 20, { toggle: 'choice', checked: true }),
        ],
        options,
      ),
      'View',
    );
    expect(
      view?.filter((each) => each.id).map((each) => [each.id, each.type, each.checked]),
    ).toEqual([
      ['tab.rightPanel', 'checkbox', true],
      ['diff.sideBySide', 'radio', false],
      ['diff.inline', 'radio', true],
    ]);
  });

  it('runs a command on a click, and nothing when a key triggered the item', () => {
    const forward = menuOf(template, 'Go')?.[1];
    clickOn(forward, true);
    expect(run).toEqual([]);
    clickOn(forward, false);
    expect(run).toEqual(['keys.forward']);
  });

  it('draws the menu again after a click on a check or a radio item, by its key or not, and only then', () => {
    let redrawn = 0;
    const ran: string[] = [];
    const view = menuOf(
      menuTree(
        'mac',
        [
          item('tab.leftPanel', 'View', 'panels', 10, { toggle: 'switch', checked: true }),
          item('diff.inline', 'View', 'diff', 20, { toggle: 'choice', checked: true }),
          item('keys.palette', 'View', 'palette', 10),
        ],
        { ...options, run: (id) => ran.push(id), redraw: () => (redrawn += 1) },
      ),
      'View',
    );
    const byId = (id: string) => view?.find((each) => each.id === id);
    clickOn(byId('tab.leftPanel'), false);
    clickOn(byId('tab.leftPanel'), true);
    clickOn(byId('diff.inline'), false);
    expect(redrawn).toBe(3);
    expect(ran).toEqual(['tab.leftPanel', 'diff.inline']);
    clickOn(byId('keys.palette'), false);
    expect(redrawn).toBe(3);
    expect(ran).toEqual(['tab.leftPanel', 'diff.inline', 'keys.palette']);
  });

  it('offers the developer tools only when asked', () => {
    const withTools = menuTree('mac', items, { ...options, devTools: true });
    expect(partsOf(withTools, 'View')).toEqual([
      'diff.inline',
      'separator',
      'toggleDevTools',
      'separator',
      'togglefullscreen',
    ]);
  });
});

describe('the app menu on Linux', () => {
  const linux = [
    ...items,
    item('settings.open', 'Lo', 'app', 20, { label: 'Settings' }),
    item('app.quit', 'File', 'quit', 10),
    item('app.fullScreen', 'View', 'screen', 10),
    item('app.about', 'Help', 'about', 10),
  ];
  const template = appMenu('linux', linux, options);

  it("is the same tree, with Lo's commands where macOS has its own", () => {
    expect(template.map((each) => each.label)).toEqual([
      'Lo',
      'File',
      'Edit',
      'View',
      'Go',
      'Window',
      'Help',
    ]);
    expect(partsOf(template, 'Lo')).toEqual(['settings.open']);
    expect(menuOf(template, 'Lo')?.[0]?.label).toBe('Settings');
    expect(partsOf(template, 'File')).toEqual(['app.quit']);
    expect(partsOf(template, 'View')).toEqual(['diff.inline', 'separator', 'app.fullScreen']);
    expect(partsOf(template, 'Window')).toEqual(['minimize']);
    expect(partsOf(template, 'Help')).toEqual(['app.about']);
    // Only macOS fills a menu by its role.
    expect(template.some((each) => each.role !== undefined)).toBe(false);
  });

  it('is the tree macOS gets on macOS', () => {
    expect(topOf(appMenu('darwin', linux, options))).toEqual(
      topOf(menuTree('mac', linux, options)),
    );
    expect(topOf(appMenu('darwin', linux, options))).not.toEqual(topOf(template));
  });
});

/** The accelerator for `name` with these modifiers held. */
function key(name: string, held: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>) {
  return acceleratorOf({ key: name, meta: false, ctrl: false, alt: false, shift: false, ...held });
}

it('writes keys as Electron accelerators', () => {
  expect(key('p', { meta: true, shift: true })).toBe('Command+Shift+P');
  expect(key('enter', { meta: true })).toBe('Command+Return');
  expect(key('enter', { alt: true })).toBe('Alt+Return');
  expect(key(']', { meta: true, shift: true })).toBe('Command+Shift+]');
  expect(key('\\', { meta: true })).toBe('Command+\\');
  expect(key('tab', { ctrl: true, shift: true })).toBe('Control+Shift+Tab');
  expect(key('f5', { meta: true })).toBe('Command+F5');
  expect(key('=', { meta: true, shift: true })).toBe('Command+Shift+=');
  expect(key('é', { meta: true })).toBeUndefined();
});
