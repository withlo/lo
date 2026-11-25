// The page the panes spec drives: a row of a left panel, its edge and a middle, laid out by
// `fitWidths` in the row's width, with Lo's keys listening, and a log of what the edge said and of
// the keys that reached the page. The panel keeps its saved width apart from the one a drag shows,
// as the app does, and `x` closes it, to take the edge away mid-drag.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { listen, Registry } from '../../src/commands/index.ts';
import { fitWidths, type Sizes } from '../../src/fit.ts';
import { Panes, Splitter } from '../../src/Panes.tsx';

/** What happened, in order: `drag 260`, `end 300`, `cancel`, `reset`, `close`, `key Escape`. */
const log: string[] = [];

declare global {
  interface Window {
    paneLog: string[];
  }
}
window.paneLog = log;

const sizes: Sizes = {
  left: { width: 300, min: 220, max: 480 },
  threads: { width: 340, min: 280, max: 560 },
  view: 340,
  reading: 904,
  gap: 8,
};

// Lo's keys, with none of its commands: a key the registry passes on reaches the page.
listen(window, new Registry({ system: 'mac', commands: [] }));
let closeKey = () => {};
document.addEventListener('keydown', (event) => {
  log.push(`key ${event.key}`);
  if (event.key === 'x') closeKey();
});

function Scene() {
  const [row, setRow] = useState(0);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const [drag, setDrag] = useState<{ width: number; closing: boolean } | undefined>(undefined);
  const [open, setOpen] = useState(true);
  closeKey = () => setOpen(false);
  const closing = drag?.closing ?? false;
  const drawn = fitWidths(
    { left: { open, width: drag?.width ?? saved }, threads: { open: false }, beside: false },
    row,
    sizes,
  );
  const width = drawn.left ?? 0;
  return (
    <Panes id="row" style={{ height: '600px' }} onWidth={setRow}>
      {open && (
        <>
          <aside
            id="left"
            className={`${closing ? 'hidden' : 'flex'} flex-none flex-col overflow-auto bg-bg-chrome`}
            style={{ width }}
          >
            <button id="row-button" type="button">
              a.ts
            </button>
            <div className="h-tabbar-h" />
          </aside>
          <Splitter
            label="Resize left panel"
            value={width}
            range={drawn.edges.left ?? { min: width, max: width }}
            onDrag={(value, close) => {
              log.push(`drag ${Math.round(value)}${close ? ' closing' : ''}`);
              setDrag({ width: value, closing: close });
            }}
            onEnd={(value) => {
              log.push(`end ${Math.round(value)}`);
              setDrag(undefined);
              setSaved(value);
            }}
            onCancel={() => {
              log.push('cancel');
              setDrag(undefined);
            }}
            onReset={() => {
              log.push('reset');
              setSaved(undefined);
            }}
            onClose={() => {
              log.push('close');
              setDrag(undefined);
              setOpen(false);
            }}
          />
        </>
      )}
      <main id="middle" className="min-w-0 flex-1 sheet">
        <button id="open" type="button" onClick={() => setOpen(true)}>
          Left panel
        </button>
      </main>
    </Panes>
  );
}

createRoot(document.getElementById('root')!).render(<Scene />);
