// The window's own commands on Linux, which has no app menu to quit, zoom or go full screen from.
// On macOS, the app menu's roles do these.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('app', {
  /** Ctrl+Q quits wherever focus is, as in other Linux apps, even over Vim's ⌃q in code views. */
  quit: {
    label: 'Quit Lo',
    group: 'Tabs and window',
    keys: ['cmd+q'],
    overVim: true,
    when: { system: 'linux' },
  },
  /** `cmd+plus` is Ctrl and the key that types `+`: Shift and `=` on a US keyboard. */
  zoomIn: {
    label: 'Zoom in',
    group: 'Tabs and window',
    keys: ['cmd+=', 'cmd+plus'],
    when: { system: 'linux' },
  },
  zoomOut: {
    label: 'Zoom out',
    group: 'Tabs and window',
    keys: ['cmd+-'],
    when: { system: 'linux' },
  },
  actualSize: {
    label: 'Actual size',
    group: 'Tabs and window',
    keys: ['cmd+0'],
    when: { system: 'linux' },
  },
  fullScreen: {
    label: 'Full screen',
    group: 'Tabs and window',
    keys: ['f11'],
    when: { system: 'linux' },
  },
});
