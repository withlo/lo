// The gear at the end of the tab strip, which opens Settings as `⌘,` does, with the command's
// name and key in its tooltip.

import { SettingsCommand } from '@lo/ui';

export function Gear() {
  return (
    <SettingsCommand command="settings.open" variant="ghost" size="sm" icon aria-label="Settings">
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2" />
        <circle cx="8" cy="8" r="4.75" />
        <path d="M8 1.5v1.75M8 12.75v1.75M14.5 8h-1.75M3.25 8H1.5M12.6 3.4l-1.24 1.24M4.64 11.36 3.4 12.6M12.6 12.6l-1.24-1.24M4.64 4.64 3.4 3.4" />
      </svg>
    </SettingsCommand>
  );
}
