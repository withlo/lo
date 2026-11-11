import { handlers } from '@lo/ui/commands';

import { barItems, focusedTarget } from '../../../window/commands/bar.ts';
import { focusMiddle, here, registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';

/**
 * Keeps main's app menu in step with the registry: its commands' labels, keys and whether they
 * can run where focus is. Sends only when something changed.
 */
function syncMenu(menu: Client<typeof contract>): void {
  let sent = '';
  let queued = false;
  const send = () => {
    queued = false;
    const items = barItems(registry(), focusedTarget());
    const json = JSON.stringify(items);
    if (json === sent) return;
    sent = json;
    menu.menu({ items }).catch((error: unknown) => {
      console.error("Lo couldn't update its menu:", error);
    });
  };
  const soon = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(send);
  };
  registry().subscribe(soon);
  window.addEventListener('focusin', soon);
  window.addEventListener('focusout', soon);
  send();
}

export default {
  commands: handlers(keys, {
    escape: { run: focusMiddle },
    back: {
      run() {
        registry().history.back(here());
      },
    },
    forward: {
      run() {
        registry().history.forward();
      },
    },
  }),
  start() {
    const menu = client(contract);
    // A click in the app menu runs through the registry, on what has focus, as a key would.
    menu.subscribe('run', ({ id }) => {
      registry().run(id, focusedTarget());
    });
    // Linux has no app menu.
    if (registry().system === 'mac') syncMenu(menu);
  },
} satisfies WindowFeature;
