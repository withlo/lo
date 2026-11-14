// @vitest-environment jsdom
// The comment box's keys are declared in the registry but run by the box's editor. The registry
// lists them and checks them but passes each one on untouched, so the editor still hears every key
// it did before, and the labels in the box's foot are read from the declarations, so they can't
// say something the box doesn't do.

import { createComposer, type ComposerEvents } from '@lo/ui/code';
import {
  helpGroups,
  listen,
  parseKeys,
  systemStrokes,
  type Declaration,
  type KeySpec,
  type Registry,
  type Stroke,
} from '@lo/ui/commands';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { featureCommands } from '../../../window/features.ts';
import keys from '../keys.ts';
import { boxKeys, type BoxKey } from './boxkeys.ts';

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** jsdom has no fonts, no resize observer and no layout: the editor needs only that they exist. */
beforeAll(() => {
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: noRects });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/** What the box tells its caller, recorded. */
type Events = { [Name in keyof ComposerEvents]-?: Mock<NonNullable<ComposerEvents[Name]>> };

function events(): Events {
  return {
    change: vi.fn<ComposerEvents['change']>(),
    submit: vi.fn<ComposerEvents['submit']>(),
    close: vi.fn<ComposerEvents['close']>(),
    mode: vi.fn<NonNullable<ComposerEvents['mode']>>(),
    preview: vi.fn<NonNullable<ComposerEvents['preview']>>(),
    attach: vi.fn<NonNullable<ComposerEvents['attach']>>(),
    files: vi.fn<NonNullable<ComposerEvents['files']>>(),
    dragging: vi.fn<NonNullable<ComposerEvents['dragging']>>(),
  };
}

/** The keys the box's frame names, which the editor runs. */
const named: readonly BoxKey[] = ['addToReview', 'postNow', 'preview', 'attach'];

/** What the editor does for each of its keys, which is what the box's frame says it does. */
const does: Readonly<Record<BoxKey, (on: Events) => void>> = {
  addToReview: (on) => expect(on.submit).toHaveBeenLastCalledWith('review'),
  postNow: (on) => expect(on.submit).toHaveBeenLastCalledWith('now'),
  preview: (on) => expect(on.preview).toHaveBeenLastCalledWith(true),
  attach: (on) => expect(on.attach).toHaveBeenCalledOnce(),
};

/** The keys a declaration of a key gives, in Lo's notation. */
function written(spec: KeySpec): string {
  return typeof spec === 'string' ? spec : spec.keys;
}

/** The key a declaration of `name` gives first, as a key event, which Linux sends as Ctrl. */
function eventOf(name: BoxKey | 'close'): KeyboardEventInit {
  const [first] = keys.commands[name].keys;
  if (first === undefined) throw new Error(`comments.${name} has no key.`);
  const [stroke] = systemStrokes(parseKeys(written(first)), 'linux');
  return keydown(stroke!);
}

/** `stroke` as a keydown, as the DOM names its keys. */
function keydown(stroke: Stroke): KeyboardEventInit {
  const names: Readonly<Record<string, string>> = { enter: 'Enter', esc: 'Escape' };
  return {
    key: names[stroke.key] ?? stroke.key,
    ctrlKey: stroke.ctrl,
    metaKey: stroke.meta,
    altKey: stroke.alt,
    shiftKey: stroke.shift,
    bubbles: true,
    cancelable: true,
  };
}

let registry: Registry;
let stop: () => void;
let record: (event: KeyboardEvent) => void;
let on: Events;
let content: HTMLElement;
/** What the keys did on their way to the editor: seen by a listener the registry's is first of. */
let seen: { key: string; prevented: boolean }[];

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  // jsdom isn't a Mac, so the editor reads `⌘` as Ctrl, which is what Linux sends.
  registry = createRegistry(featureCommands(), 'linux');
  stop = listen(window, registry);
  seen = [];
  record = (event) => {
    seen.push({ key: event.key, prevented: event.defaultPrevented });
  };
  document.addEventListener('keydown', record, true);
  on = events();
  const host = document.getElementById('host')!;
  const box = createComposer(host, { draft: 'Hello', nonce: '' }, on);
  box.focus();
  content = host.querySelector<HTMLElement>('.cm-content')!;
});

afterEach(() => {
  document.removeEventListener('keydown', record, true);
  stop();
});

/** Presses a key on the box's editor. */
function press(event: KeyboardEventInit): void {
  content.dispatchEvent(new KeyboardEvent('keydown', event));
}

describe('the keys the box’s editor runs', () => {
  test.each(named)(
    '%s is declared as the editor’s, so it reaches the editor untouched and does what it says',
    (name) => {
      expect(keys.commands[name].editor).toBe(true);
      const event = eventOf(name);
      press(event);
      expect(seen).toEqual([{ key: event.key, prevented: false }]);
      does[name](on);
    },
  );

  test('Esc leaves insert mode, and then closes the box, keeping the draft', () => {
    const esc = eventOf('close');
    press(esc);
    press(esc);
    expect(seen).toEqual([
      { key: 'Escape', prevented: false },
      { key: 'Escape', prevented: false },
    ]);
    expect(on.mode).toHaveBeenCalledWith('normal');
    expect(on.close).toHaveBeenCalledWith(true);
  });

  test('every key declared as the editor’s is covered here', () => {
    const declared: Record<string, Declaration> = keys.commands;
    const flagged = Object.entries(declared)
      .filter(([, command]) => command.editor)
      .map(([name]) => name);
    expect(flagged.toSorted()).toEqual([...named, 'close'].toSorted());
  });

  test('the registry holds none of them, held or after another key', () => {
    for (const name of [...named, 'close' as const]) {
      press(eventOf(name));
      expect(registry.isPending()).toBe(false);
    }
  });
});

describe('the keys in the box’s foot', () => {
  test.each([
    ['addToReview', '⌘⏎'],
    ['postNow', '⌥⏎'],
    ['preview', '⌘⇧V'],
    ['attach', '⌘⇧A'],
  ] as const)('%s is shown as %s, as the keys of the docs and key help show it', (name, label) => {
    const mac = createRegistry(featureCommands(), 'mac');
    expect(boxKeys(name)).toEqual([label]);
    const row = helpGroups(mac)
      .flatMap((group) => group.rows)
      .find((each) => each.id === `comments.${name}`);
    expect(row?.keys).toEqual([[label]]);
  });
});
