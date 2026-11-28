// What a glossary's term offers in the window, wherever it is: in an overview's text, its card or
// its row. Its row expands, and from the text it goes to its row to show its history. Its menu's two
// switches show it as plain text, in this repo or in every repo. Each through what the overview
// shares; they go with overviews, as Settings turns them off, and come back.

import { handlers, type TermTarget } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import {
  followOverviews,
  isTermExpanded,
  isTermIgnored,
  showTermHistory,
  termExpandListed,
  termExpandReady,
  termHistoryReady,
  termSwitchReady,
  turnTermExpanded,
  turnTermIgnored,
} from '../../overview/window/shared.ts';
import keys from '../keys.ts';

/** Every command of the terms', which go with overviews. */
const COMMANDS = Object.keys(keys.commands).map((name) => `${keys.feature}.${name}`);

/** What Expand term is called on the row `target` names: "Collapse term" on one expanded. */
function expandName(target: TermTarget): string | undefined {
  return isTermExpanded(target) ? 'Collapse term' : undefined;
}

export default {
  commands: handlers(keys, {
    history: {
      run: showTermHistory,
      enabled: termHistoryReady,
      // Its row has Expand term in its place.
      listed: (target) => target.row !== true,
    },
    expand: {
      run: turnTermExpanded,
      enabled: termExpandReady,
      listed: termExpandListed,
      named: expandName,
      labelled: expandName,
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
