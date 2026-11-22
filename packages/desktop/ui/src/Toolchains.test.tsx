// @vitest-environment jsdom
// Settings' list of the toolchains language servers use: a row each, saying how much room it takes
// or that it isn't downloaded, what uses it, and, once it's downloaded, the button that removes it;
// or, for one of the system's, where it's from or what it needs.

import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render } from '../test/dom.ts';
import { ToolchainList, type ToolchainEntry } from './Toolchains.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const ENTRIES: ToolchainEntry[] = [
  {
    id: 'go',
    name: 'Go',
    version: '1.27.4',
    installed: '229.1 MB',
    download: '65.1 MB',
    uses: ['Go'],
  },
  { id: 'rust', name: 'Rust', version: '1.100.0', download: '150.7 MB', uses: [] },
  {
    id: 'temurin',
    name: 'Temurin JDK',
    version: '25.0.5+8',
    installed: '293.5 MB',
    download: '130.1 MB',
    uses: ['Java', 'Kotlin'],
  },
  {
    id: 'dotnet',
    name: '.NET SDK',
    version: '10.0.404',
    installed: '643.5 MB',
    download: '222.8 MB',
    uses: ['C#'],
  },
  {
    kind: 'system',
    id: 'swift',
    name: 'Swift',
    from: 'Xcode',
    needs: 'Apple’s Command Line Tools',
    uses: ['Swift'],
  },
];

/** The list as Settings holds it: a toolchain removed stays, no longer downloaded. */
function Held({ entries }: { entries: readonly ToolchainEntry[] }) {
  const [held, setHeld] = useState(entries);
  return (
    <ToolchainList
      entries={held}
      onRemove={(id) =>
        setHeld((all) =>
          all.map((entry) => (entry.id === id ? { ...entry, installed: undefined } : entry)),
        )
      }
    />
  );
}

/** The "Delete" button of the row for `id`. */
function remove(host: HTMLElement, id: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`[role="listitem"][data-id="${id}"] button`);
}

describe('ToolchainList', () => {
  it('lists each toolchain with its version, its size or that it isn’t downloaded, and its users', () => {
    const host = render(<ToolchainList entries={ENTRIES} />);
    const rows = [...host.querySelectorAll('[role="listitem"]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Go 1.27.4229.1 MB · For GoDeleteDeleting…',
      'Rust 1.100.0Not downloaded · 150.7 MB · Not used yet',
      'Temurin JDK 25.0.5+8293.5 MB · For Java and KotlinDeleteDeleting…',
      '.NET SDK 10.0.404643.5 MB · For C#DeleteDeleting…',
      'SwiftFrom Xcode · For Swift',
    ]);
    expect(host.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe('Toolchains');
  });

  it('says what one of the system’s needs while there’s none, and has nothing to remove', () => {
    const host = render(
      <ToolchainList
        entries={[
          {
            kind: 'system',
            id: 'swift',
            name: 'Swift',
            needs: 'Apple’s Command Line Tools',
            uses: ['Swift'],
          },
        ]}
      />,
    );
    expect(host.querySelector('[role="listitem"]')?.textContent).toBe(
      'SwiftNeeds Apple’s Command Line Tools · For Swift',
    );
    expect(host.querySelector('button')).toBeNull();
    expect(remove(render(<ToolchainList entries={ENTRIES} />), 'swift')).toBeNull();
  });

  it('removes the toolchain whose button was pressed, naming it to a screen reader', () => {
    const onRemove = vi.fn<(id: string) => void>();
    const host = render(<ToolchainList entries={ENTRIES} onRemove={onRemove} />);
    expect(remove(host, 'temurin')?.getAttribute('aria-label')).toBe('Delete Temurin JDK');
    click(remove(host, 'temurin')!);
    expect(onRemove).toHaveBeenCalledWith('temurin');
  });

  it('has the button of one being removed wait, taking no press, and keep focus', () => {
    const onRemove = vi.fn<(id: string) => void>();
    const removing = ENTRIES.map((entry) => ({ ...entry, removing: entry.id === 'go' }));
    const host = render(<ToolchainList entries={removing} onRemove={onRemove} />);
    const button = remove(host, 'go')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Delete Go');
    expect(button.textContent).toContain('Deleting…');
    focus(button);
    click(button);
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    // The others take a press as ever.
    expect(remove(host, 'temurin')?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('moves focus to the next downloaded row’s button once a toolchain is removed', () => {
    const host = render(<Held entries={ENTRIES} />);
    focus(remove(host, 'go')!);
    click(remove(host, 'go')!);
    expect(remove(host, 'go')).toBeNull();
    // Past Rust, which has nothing to remove.
    expect(document.activeElement).toBe(remove(host, 'temurin'));
    // Back past Swift, the system's, which has nothing to remove.
    click(remove(host, 'dotnet')!);
    expect(document.activeElement).toBe(remove(host, 'temurin'));
  });

  it('moves focus to the list once nothing downloaded is left', () => {
    const host = render(<Held entries={[ENTRIES[0]!, ENTRIES[1]!]} />);
    focus(remove(host, 'go')!);
    click(remove(host, 'go')!);
    const list = host.querySelector<HTMLElement>('[aria-label="Toolchains"]')!;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute('tabindex')).toBe('-1');
    expect(host.textContent).toContain('Not downloaded · 65.1 MB');
  });

  it('says when none is downloaded for this computer', () => {
    const host = render(<ToolchainList entries={[]} />);
    expect(host.textContent).toBe('No toolchains for this computer');
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Toolchains');
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <ToolchainList entries={ENTRIES} />
        <ToolchainList entries={[]} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
