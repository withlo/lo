// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import keys from '../../features/keys/window/index.ts';
import type { Bridge } from '../../ipc/bridge.ts';
import {
  closeOverlay,
  openPalette,
  overlay,
  Overlays,
  showHighlighted,
  toggleHelp,
  togglePalette,
} from './overlays.tsx';
import { applyKeymapFile } from './keymap.ts';
import { createRegistry, registry } from './registry.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;

beforeEach(() => {
  createRegistry(keys.commands, 'mac');
  const page = document.createElement('div');
  page.id = 'root';
  page.className = 'lo-app';
  const middle = document.createElement('main');
  middle.tabIndex = -1;
  page.append(middle);
  document.body.append(page);
  middle.focus();
  root = createRoot(page.appendChild(document.createElement('div')));
  act(() => root?.render(<Overlays />));
});

afterEach(() => {
  act(() => closeOverlay());
  act(() => root?.unmount());
  document.body.replaceChildren();
});

const dialog = (name: string) =>
  [...document.querySelectorAll('[role="dialog"]')].find(
    (each) =>
      each.getAttribute('aria-label') === name ||
      document.getElementById(each.getAttribute('aria-labelledby') ?? '')?.textContent === name,
  );

/** Types into the field, as React hears it: through the setter React watches. */
function type(field: HTMLInputElement, text: string): void {
  act(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** What key help's alerts say. */
function alerts(): (string | null)[] {
  return [...document.querySelectorAll('[role="alert"]')].map((each) => each.textContent);
}

/** The keys key help shows for Back. */
function backKeys(): (string | null)[] {
  return [...document.querySelectorAll('[data-command="keys.back"] kbd')].map(
    (kbd) => kbd.textContent,
  );
}

describe('key help', () => {
  it('opens and closes with ?', async () => {
    act(() => toggleHelp());
    expect(dialog('Every key')).toBeDefined();
    act(() => toggleHelp());
    await vi.waitFor(() => expect(dialog('Every key')).toBeUndefined());
    expect(overlay()).toBeUndefined();
  });

  it('shows a remap from the keymap file as it happens', () => {
    act(() => toggleHelp());
    expect(backKeys()).toEqual(['⌃o']);
    act(() => {
      registry().setKeymap('bind ctrl+b keys.back');
    });
    expect(backKeys()).toEqual(['⌃b', '⌃o']);
    act(() => {
      registry().setKeymap('nonsense');
    });
    expect(backKeys()).toEqual(['⌃o']);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Line 1:');
  });
});

describe('key help and the keymap file', () => {
  it('shows what is wrong with the file, and its lines that can’t be used, as they change', () => {
    act(() => toggleHelp());
    expect(alerts()).toEqual([]);
    act(() =>
      applyKeymapFile({
        text: '',
        problem: "The keymap file is over 1 MiB, so Lo didn't read it.",
      }),
    );
    expect(alerts()).toEqual(["The keymap file is over 1 MiB, so Lo didn't read it."]);
    act(() => applyKeymapFile({ text: 'bind x nope.nothing\n# fine\nbnid y keys.back' }));
    expect(alerts()).toEqual([
      "The keymap file has 2 lines Lo can't use:Line 1: There's no command called nope.nothing.Line 3: A line starts with bind, unbind, vim or #, not bnid.",
    ]);
    act(() => applyKeymapFile({ text: 'bind ctrl+b keys.back' }));
    expect(alerts()).toEqual([]);
    expect(backKeys()).toEqual(['⌃b', '⌃o']);
  });

  it('opens the keymap file from its button, through the command', async () => {
    const invoke = vi.fn<Bridge['invoke']>(async () => ({ ok: true, value: undefined }));
    Reflect.set(window, 'lo', { invoke, subscribe: () => () => undefined });
    act(() => toggleHelp());
    const button = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === 'Open the keymap file',
    );
    act(() => button?.click());
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('keys.openKeymap', undefined));
    // Key help stays up, so the file's errors are there when Lo is back.
    expect(dialog('Every key')).toBeDefined();
  });
});

describe('the palette', () => {
  it('lists the commands for what had focus, and runs one with ⏎ once it has closed', async () => {
    act(() => togglePalette());
    const palette = dialog('Command palette');
    expect(palette?.getAttribute('data-lo-scope')).toBe('palette');
    const input = palette?.querySelector('input');
    type(input!, 'every key');
    expect(palette?.querySelector('[role="option"]')?.textContent).toContain('Every key');
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await vi.waitFor(() => expect(dialog('Every key')).toBeDefined());
    expect(dialog('Command palette')).toBeUndefined();
  });

  it('says why ⌥⏎ did nothing when no action matches, until what’s typed changes', () => {
    act(() => openPalette());
    const palette = dialog('Command palette');
    const input = palette?.querySelector('input');
    type(input!, 'zzzz');
    expect(palette?.querySelector('[role="option"]')).toBeNull();
    let shown: true | string = true;
    act(() => {
      shown = showHighlighted();
    });
    expect(shown).toBe("No action matches, so there's no key to show.");
    // The palette stays open and says it, in a live region.
    expect(dialog('Command palette')).toBeDefined();
    const said = () =>
      [...(palette?.querySelectorAll('[role="status"]') ?? [])].map((each) => each.textContent);
    expect(said()).toContain("No action matches, so there's no key to show.");
    type(input!, 'forward');
    expect(said()).not.toContain("No action matches, so there's no key to show.");
  });

  it('shows the highlighted command in key help on ⌥⏎', async () => {
    expect(showHighlighted()).toBe('No action is highlighted.');
    act(() => openPalette());
    const input = dialog('Command palette')?.querySelector('input');
    type(input!, 'forward');
    let shown: true | string = '';
    act(() => {
      shown = showHighlighted();
    });
    expect(shown).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-current="true"]')?.getAttribute('data-command')).toBe(
        'keys.forward',
      ),
    );
  });
});
