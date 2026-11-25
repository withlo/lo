// The page the panes spec drives: a row of a left panel, its edge and a middle, laid out by
// `fitWidths` in the row's width, with Lo's keys listening, and a log of what the edge said and of
// the keys that reached the page.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { listen, Registry } from '../../src/commands/index.ts';
import { fitWidths, type Sizes } from '../../src/fit.ts';
import { Panes, Splitter } from '../../src/Panes.tsx';

/** What happened, in order: `drag 260`, `end 300`, `reset`, `close`, `key Escape`. */
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
document.addEventListener('keydown', (event) => log.push(`key ${event.key}`));

function Scene() {
  const [row, setRow] = useState(0);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const [open, setOpen] = useState(true);
  const [closing, setClosing] = useState(false);
  const drawn = fitWidths(
    { left: { open, width: saved }, threads: { open: false }, beside: false },
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
            shift="end"
            onDrag={(value, close) => {
              log.push(`drag ${Math.round(value)}${close ? ' closing' : ''}`);
              setClosing(close);
              setSaved(value);
            }}
            onEnd={(value) => {
              log.push(`end ${Math.round(value)}`);
              setClosing(false);
              setSaved(value);
            }}
            onReset={() => {
              log.push('reset');
              setSaved(undefined);
            }}
            onClose={() => {
              log.push('close');
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
