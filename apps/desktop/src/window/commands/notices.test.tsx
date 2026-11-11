// @vitest-environment jsdom
import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import keys from '../../features/keys/window/index.ts';
import { notice, notify, NOTICE_TIME, Notices } from './notices.tsx';
import { createRegistry, registry } from './registry.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  createRegistry(keys.commands, 'mac');
  const page = document.createElement('div');
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(<Notices />));
});

afterEach(() => {
  act(() => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
  act(() => root?.unmount());
  document.body.replaceChildren();
});

const status = () => document.querySelector('[role="status"]');

describe('notices', () => {
  it('keep a live region that says each note, and take it away after a few seconds', () => {
    expect(status()?.textContent).toBe('');
    act(() => notify("There's nowhere to go back to."));
    expect(status()?.textContent).toBe("There's nowhere to go back to.");
    // A newer note takes the older one's place, and its time starts again.
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
      notify('Another.');
    });
    act(() => {
      vi.advanceTimersByTime(NOTICE_TIME - 1);
    });
    expect(status()?.textContent).toBe('Another.');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(status()?.textContent).toBe('');
    expect(notice()).toBeUndefined();
  });
});

describe('a command that did nothing', () => {
  it('says why when its handler says it can’t run, whoever asked', () => {
    const [command] = keys.commands;
    expect(command).toBeDefined();
    createRegistry(
      keys.commands.map((each) =>
        each.id === 'keys.help'
          ? { ...each, handler: { run() {}, enabled: () => 'Key help is busy.' } }
          : each,
      ),
      'mac',
    );
    act(() => {
      registry().run('keys.help', NO_TARGET);
    });
    expect(status()?.textContent).toBe('Key help is busy.');
  });

  it('says nothing when it ran', () => {
    act(() => {
      registry().run('keys.help', NO_TARGET);
    });
    expect(status()?.textContent).toBe('');
  });

  it('says where Back and Forward have nowhere to go', () => {
    act(() => {
      registry().run('keys.back', NO_TARGET);
    });
    expect(status()?.textContent).toBe("There's nowhere to go back to.");
    act(() => {
      registry().run('keys.forward', NO_TARGET);
    });
    expect(status()?.textContent).toBe("There's nowhere to go forward to.");
  });
});
