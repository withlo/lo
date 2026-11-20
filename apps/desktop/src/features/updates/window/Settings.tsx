// Settings' Updates section: the version of this Lo and the commit it's built from, with a button
// that checks now, and whether Lo checks by itself, which is the `updates.check` setting.

import { Button, Setting, Switch } from '@lo/ui';
import { useStore } from 'zustand';

import { changeSetting, defineSection, useSetting } from '../../settings/window/shared.ts';
import { check as checkSetting } from '../settings.ts';
import { check } from './actions.ts';
import { updatesStore } from './store.ts';

/** This Lo's version and the commit it's built from, with the button that asks GitHub for a newer one. */
function Version() {
  const version = useStore(updatesStore, (state) => state.version);
  const build = useStore(updatesStore, (state) => state.build);
  const checking = useStore(updatesStore, (state) => state.checking);
  return (
    <Setting label={version === undefined ? 'Lo' : `Lo ${version}`} description={build}>
      {/* Still on the button, with focus, while the check goes: it does nothing more until it ends. */}
      <Button aria-disabled={checking || undefined} onClick={() => void check()}>
        {checking ? 'Checking' : 'Check now'}
      </Button>
    </Setting>
  );
}

/** Whether Lo checks for a newer version by itself. */
function Timed() {
  const on = useSetting(checkSetting);
  return (
    <Setting
      label="Check for updates by itself"
      description="30 s after Lo starts, then every 6 hours. Off, Lo checks only when you ask."
    >
      <Switch
        checked={on}
        aria-label="Check for updates by itself"
        onCheckedChange={(next) => {
          void changeSetting(checkSetting, next);
        }}
      />
    </Setting>
  );
}

function Updates() {
  return (
    <>
      <Version />
      <Timed />
    </>
  );
}

export default defineSection({
  id: 'updates.settings',
  title: 'Updates',
  description: 'Lo gets its updates from GitHub Releases.',
  order: 80,
  render: Updates,
});
