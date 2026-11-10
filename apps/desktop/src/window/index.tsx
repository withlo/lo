import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Window } from './Window.tsx';

// The design system's platform rules key off these. On Linux the window is frameless, with the
// system's controls drawn over the end of the tab strip.
if (navigator.platform.startsWith('Linux')) {
  document.documentElement.dataset.loPlatform = 'linux';
  document.documentElement.dataset.loFrame = 'custom';
}

const root = document.getElementById('root');
if (!root) throw new Error("Lo's page has no #root element.");
createRoot(root).render(
  <StrictMode>
    <Window />
  </StrictMode>,
);
