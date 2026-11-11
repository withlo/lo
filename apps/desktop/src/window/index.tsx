import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

import { listenForBackground } from './background.ts';
import { startCommands } from './commands/index.ts';
import { featureViews, startFeatures } from './features.ts';
import { Slots } from './slots.tsx';
import { Window } from './Window.tsx';

// Zod would otherwise try compiling its parsers with `new Function`, which the window's content
// security policy blocks.
z.config({ jitless: true });

// The design system's platform rules key off these. On Linux the window is frameless, with the
// system's controls drawn over the end of the tab strip.
if (navigator.platform.startsWith('Linux')) {
  document.documentElement.dataset.loPlatform = 'linux';
  document.documentElement.dataset.loFrame = 'custom';
}

// Main hands the window a port to the background process as soon as the page loads.
listenForBackground();
// The registry listens before any feature starts, so it sees every key.
startCommands();
startFeatures();

const root = document.getElementById('root');
if (!root) throw new Error("Lo's page has no #root element.");
createRoot(root).render(
  <StrictMode>
    <Slots views={featureViews()}>
      <Window />
    </Slots>
  </StrictMode>,
);
