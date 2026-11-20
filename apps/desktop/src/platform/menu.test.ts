import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import type { BarItem } from '../features/keys/contract.ts';
import { acceleratorOf, appMenu, macMenu } from './menu.ts';

const items: BarItem[] = [
  {
    id: 'keys.forward',
    label: 'Forward',
    menu: 'Go',
    order: 20,
    key: { key: 'i', meta: false, ctrl: true, alt: false, shift: false },
    enabled: true,
  },
  {
    id: 'keys.back',
    label: 'Back',
    menu: 'Go',
    order: 10,
    key: { key: 'o', meta: false, ctrl: true, alt: false, shift: false },
    enabled: false,
  },
  { id: 'view.inline', label: 'Inline or side by side', menu: 'View', order: 5, enabled: true },
];

/** A command in the app menu's Update submenu. */
const update = (id: string, order: number, enabled: boolean): BarItem => ({
  id,
  label: id,
  menu: 'Update',
  order,
  enabled,
});

function menuOf(template: MenuItemConstructorOptions[], label: string) {
  const found = template.find((each) => each.label === label);
  return Array.isArray(found?.submenu) ? found.submenu : undefined;
}

/** Every role and accelerator in a template, however deep. */
function everything(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => [
    ...(item.role ? [`role:${item.role}`] : []),
    ...(typeof item.accelerator === 'string' ? [`key:${item.accelerator}`] : []),
    ...(Array.isArray(item.submenu) ? everything(item.submenu) : []),
  ]);
}

describe('the macOS app menu', () => {
  const run: string[] = [];
  const template = macMenu(items, { name: 'Lo', devTools: false, run: (id) => run.push(id) });

  it('never reloads the page or closes the window by key', () => {
    const all = everything(template);
    for (const missing of [
      'role:reload',
      'role:forceReload',
      'role:close',
      'role:toggleDevTools',
    ]) {
      expect(all).not.toContain(missing);
    }
    expect(all.filter((each) => /\+[RW]$/.test(each))).toEqual([]);
  });

  it("keeps the system's roles: the app's menu, editing and the window", () => {
    expect(template.map((each) => each.label)).toEqual(['Lo', 'Edit', 'View', 'Go', 'Window']);
    expect(menuOf(template, 'Lo')?.map((each) => each.role ?? each.type)).toEqual([
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
    expect(menuOf(template, 'Edit')?.map((each) => each.role ?? each.type)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    expect(template.at(-1)?.role).toBe('windowMenu');
    expect(menuOf(template, 'Window')?.map((each) => each.role ?? each.type)).toEqual([
      'minimize',
      'zoom',
      'separator',
      'front',
    ]);
  });

  it("puts commands for the app's own menu after About", () => {
    const install: BarItem = {
      id: 'open.installCommand',
      label: 'Install command-line tool',
      menu: 'App',
      order: 10,
      enabled: true,
    };
    const withApp = macMenu([install], { name: 'Lo', devTools: false, run: () => undefined });
    expect(menuOf(withApp, 'Lo')?.map((each) => each.id ?? each.role ?? each.type)).toEqual([
      'about',
      'separator',
      'open.installCommand',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
  });

  it('puts the commands of the Update menu in a submenu of the app’s own, after its others', () => {
    const check: BarItem = {
      id: 'updates.check',
      label: 'Check for updates',
      menu: 'App',
      order: 1,
      enabled: true,
    };
    const build = (...rest: BarItem[]) =>
      menuOf(
        macMenu([check, ...rest], { name: 'Lo', devTools: false, run: () => undefined }),
        'Lo',
      );
    const withUpdate = build(update('updates.copy', 2, false), update('updates.move', 1, true));
    expect(withUpdate?.map((each) => each.id ?? each.label ?? each.role ?? each.type)).toEqual([
      'about',
      'separator',
      'updates.check',
      'Update',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    const submenu = withUpdate?.find((each) => each.label === 'Update');
    expect(Array.isArray(submenu?.submenu) && submenu.submenu.map((each) => each.id)).toEqual([
      'updates.move',
      'updates.copy',
    ]);
    // It can be opened while something in it can run, and is greyed when nothing can.
    expect(submenu?.enabled).toBe(true);
    const greyed = build(update('updates.copy', 2, false), update('updates.move', 1, false));
    expect(greyed?.find((each) => each.label === 'Update')?.enabled).toBe(false);
    // And it isn't there when no command is in it.
    expect(build()?.some((each) => each.label === 'Update')).toBe(false);
  });

  it("puts Lo's commands in their menus, in order, with their keys and states", () => {
    expect(
      menuOf(template, 'Go')?.map((each) => [each.id, each.label, each.accelerator, each.enabled]),
    ).toEqual([
      ['keys.back', 'Back', 'Control+O', false],
      ['keys.forward', 'Forward', 'Control+I', true],
    ]);
    expect(menuOf(template, 'View')?.map((each) => each.id ?? each.role ?? each.type)).toEqual([
      'view.inline',
      'separator',
      'togglefullscreen',
    ]);
    // A menu Lo has nothing in isn't shown.
    expect(menuOf(template, 'File')).toBeUndefined();
    expect(menuOf(template, 'Review')).toBeUndefined();
  });

  it('runs a command on a click, and nothing when a key triggered the item', () => {
    const back = menuOf(template, 'Go')?.[0];
    const click = (triggeredByAccelerator: boolean) =>
      back?.click?.(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the event is read.
        {} as Parameters<NonNullable<MenuItemConstructorOptions['click']>>[0],
        undefined,
        { triggeredByAccelerator, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
      );
    click(true);
    expect(run).toEqual([]);
    click(false);
    expect(run).toEqual(['keys.back']);
  });

  it('offers the developer tools only when asked', () => {
    const withTools = macMenu(items, { name: 'Lo', devTools: true, run: () => {} });
    expect(menuOf(withTools, 'View')?.map((each) => each.role ?? each.id ?? each.type)).toEqual([
      'view.inline',
      'separator',
      'toggleDevTools',
      'separator',
      'togglefullscreen',
    ]);
  });
});

it('Linux has no app menu', () => {
  expect(appMenu('linux', items, { name: 'Lo', devTools: true, run: () => {} })).toBeNull();
  expect(appMenu('darwin', items, { name: 'Lo', devTools: false, run: () => {} })).not.toBeNull();
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
