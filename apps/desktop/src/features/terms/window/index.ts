// What a glossary's term offers in the window, wherever it is: in an overview's text, its card or
// its row. Edit term opens on it; its menu's two switches show it as plain text, in this repo or in
// every repo, through what the overview shares; they go with overviews, as Settings turns them off,
// and come back.

import { handlers } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import {
  editTerm,
  followOverviews,
  isTermIgnored,
  termEditReady,
  termSwitchReady,
  turnTermIgnored,
} from '../../overview/window/shared.ts';
import keys from '../keys.ts';

/** Every command of the terms', which go with overviews. */
const COMMANDS = Object.keys(keys.commands).map((name) => `${keys.feature}.${name}`);

export default {
  commands: handlers(keys, {
    edit: {
      run: editTerm,
      enabled: termEditReady,
    },
    ignoreHere: {
      run: (target) => turnTermIgnored(target, 'repo'),
      enabled: termSwitchReady,
      checked: (target) => isTermIgnored(target, 'repo'),
    },
    ignoreAll: {
      run: (target) => turnTermIgnored(target, 'every'),
      enabled: termSwitchReady,
      checked: (target) => isTermIgnored(target, 'every'),
    },
  }),
  start() {
    followOverviews((on) => registry().setOff(COMMANDS, !on));
  },
} satisfies WindowFeature;
