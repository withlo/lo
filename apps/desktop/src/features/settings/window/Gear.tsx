// The gear at the end of the tab strip, which opens Settings as `⌘,` does, with the command's
// name and key in its tooltip.

import { Icon, SettingsCommand } from '@lo/ui';

export function Gear() {
  return (
    <SettingsCommand command="settings.open" variant="ghost" size="sm" icon aria-label="Settings">
      <Icon name="settings" size={16} />
    </SettingsCommand>
  );
}
