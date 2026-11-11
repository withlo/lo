import { ThemeChoice } from '@lo/ui';

import { theme } from '../settings.ts';
import { changeSetting, defineSection, useSetting } from './shared.ts';

function Appearance() {
  const chosen = useSetting(theme);
  return (
    <ThemeChoice
      value={chosen}
      onChange={(next) => {
        void changeSetting(theme, next);
      }}
    />
  );
}

export default defineSection({
  id: 'settings.appearance',
  title: 'Appearance',
  description: 'Lo Glow, in dark or light.',
  order: 40,
  render: Appearance,
});
