// The page the icons spec reads: every icon of the set at each of its sizes, each beside the text it
// sits with, the characters `Glyphs` draws, key chips as each system writes them, and an icon still
// drawn by hand on a 16 grid, in both themes.

import { createRoot } from 'react-dom/client';

import { Button } from '../../src/Button.tsx';
import { keyLabels, parseKeys, systemStrokes, type System } from '../../src/commands/index.ts';
import { Glyphs, Icon, type IconSize } from '../../src/Icon.tsx';
import { ICONS, type IconName } from '../../src/icons.ts';
import { Key } from '../../src/Key.tsx';

/** Each size with the text it sits beside. */
const SIZES: [IconSize, string][] = [
  [12, 'text-small'],
  [14, 'text-ui'],
  [16, 'text-title'],
  [24, 'text-heading'],
];

const NAMES = Object.keys(ICONS).filter((name): name is IconName => name in ICONS);

/** Keys with a symbol, a name or a letter each, and every modifier at once, in the keymap's words. */
const KEYS = [
  'cmd+f',
  'cmd+shift+p',
  'alt+enter',
  'shift+tab',
  'tab',
  'ctrl+shift+tab',
  'enter',
  'backspace',
  'alt+delete',
  'up',
  'down',
  'left',
  'right',
  'esc',
  'space',
  'pagedown',
  'shift+f10',
  'cmd+ctrl+alt+shift+k',
  '] f',
];

/** `keys` as `system` shows them, one label per key of the sequence. */
function labels(keys: string, system: System): string[] {
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** Each of {@link KEYS} as `system` shows it, outlined and quiet, and on buttons. */
function Chips({ system }: { system: System }) {
  return (
    <div data-keys={system} className="flex flex-col gap-8 text-ui">
      <div className="flex flex-wrap items-center gap-8">
        {KEYS.map((keys) => (
          <Key key={keys} keys={labels(keys, system)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-8">
        {KEYS.map((keys) => (
          <Key key={keys} keys={labels(keys, system)} quiet />
        ))}
      </div>
      <div className="flex items-center gap-8">
        <Button variant="primary">
          Submit review… <Key keys={labels('cmd+enter', system)} />
        </Button>
        <Button>
          Comment <Key keys={labels('alt+enter', system)} />
        </Button>
        <Button disabled>
          Post <Key keys={labels('cmd+shift+enter', system)} />
        </Button>
      </div>
    </div>
  );
}

function Sheet() {
  return (
    <div className="flex flex-col gap-16 bg-bg p-24 text-fg">
      {SIZES.map(([size, type]) => (
        <div key={size} data-size={size} className={`flex items-center gap-8 ${type}`}>
          <span>Text {size}</span>
          {NAMES.map((name) => (
            <Icon key={name} name={name} size={size} />
          ))}
        </div>
      ))}
      <p className="text-fg-muted text-small" data-glyphs="12">
        <Glyphs text="Renamed old.ts → new.ts · r1 → r3 · ⌘⇧P ⌥⏎ ⌃⇥ ⌫ ⌦ ↑↓←→ ✓ ⋯ ↗ ⇄" />
      </p>
      <p className="text-ui" data-glyphs="14">
        <Glyphs text="No changes in r1 → r3 · Open the run ↗" size={14} />
      </p>
      <Chips system="mac" />
      <Chips system="linux" />
      <div className="flex items-center gap-8 text-icon-muted text-ui" data-drawn>
        <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        <span>Drawn by hand on a 16 grid</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <Sheet />
    <div data-theme="light">
      <Sheet />
    </div>
  </>,
);
