// The app feature's rows of Settings: the window's zoom, in Appearance, which `⌘+`, `⌘-` and `⌘0`
// change too, and the licenses, in About.

import { Setting, SettingsCommand } from '@lo/ui';

import { defineRow, settingRow, type ControlProps } from '../../settings/window/shared.ts';
import { zoom } from '../settings.ts';

/**
 * The zoom, between the buttons that step it down and up, as `⌘-` and `⌘+` do. The number takes
 * the room of the widest, so the buttons hold still as it changes.
 */
function Zoom({ value }: ControlProps<number>) {
  return (
    <div className="flex items-center gap-4">
      <SettingsCommand command="app.zoomOut" size="sm" icon aria-label="Zoom out">
        <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 8h8" />
        </svg>
      </SettingsCommand>
      <span className="inline-grid justify-items-center tabular-nums">
        <span className="col-start-1 row-start-1" aria-live="polite">
          {value}%
        </span>
        <span className="invisible col-start-1 row-start-1" aria-hidden="true">
          000%
        </span>
      </span>
      <SettingsCommand command="app.zoomIn" size="sm" icon aria-label="Zoom in">
        <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 4v8M4 8h8" />
        </svg>
      </SettingsCommand>
    </div>
  );
}

function Licenses({ label, description }: { label: string; description: string }) {
  return (
    <Setting label={label} description={description}>
      <SettingsCommand command="app.licenses">Show</SettingsCommand>
    </Setting>
  );
}

export default [
  // After the theme (10).
  settingRow(zoom, { order: 20, id: 'app.zoom', control: Zoom }),
  defineRow({
    id: 'app.licenses',
    group: 'about',
    order: 40,
    label: 'Licenses',
    description: 'GPL-3.0, and the licenses of the packages it ships.',
    words: () => ['license', 'open source', 'credits'],
    render: Licenses,
  }),
];
