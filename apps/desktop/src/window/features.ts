import type { Command } from '@lo/ui/commands';

import type { View } from './slots.tsx';

/** What a feature's `window/index.ts` exports by default. */
export interface WindowFeature {
  /** Runs once, before the window first renders, once the registry is listening. */
  start?(): void;
  /** The feature's commands with their handlers, from `handlers(keys, {...})`. */
  commands?: readonly Command[];
  /**
   * What the feature puts in slots, other features' or its own, each from `defineView` with a
   * slot another feature's `window/shared.ts` exports.
   */
  views?: readonly View[];
}

// Every feature folder with a window side. No file lists them.
const features = import.meta.glob<WindowFeature>('../features/*/window/index.ts', {
  eager: true,
  import: 'default',
});

export function startFeatures(): void {
  for (const feature of Object.values(features)) feature.start?.();
}

/** Every feature's commands, for the registry. */
export function featureCommands(): Command[] {
  return checkCommands(features);
}

/**
 * The commands of the features `import.meta.glob` found, keyed by path, checking that each
 * feature declares its commands under its own folder's name, as main checks its contracts.
 */
export function checkCommands(modules: Readonly<Record<string, WindowFeature>>): Command[] {
  return Object.entries(modules).flatMap(([path, feature]) => {
    const folder = /\/features\/([^/]+)\//.exec(path)?.[1];
    for (const command of feature.commands ?? []) {
      if (command.feature !== folder) {
        throw new Error(`${path} has the command ${command.id}, but its folder is "${folder}".`);
      }
    }
    return feature.commands ?? [];
  });
}

/** Every feature's views, for the window's slots. */
export function featureViews(): View[] {
  return checkViews(features);
}

/**
 * The views of the features `import.meta.glob` found, keyed by path, checking that each feature
 * names its views under its own folder's name, so no two features' views share an id.
 */
export function checkViews(modules: Readonly<Record<string, WindowFeature>>): View[] {
  const ids = new Set<string>();
  return Object.entries(modules).flatMap(([path, feature]) => {
    const folder = /\/features\/([^/]+)\//.exec(path)?.[1];
    for (const { id } of feature.views ?? []) {
      if (!id.startsWith(`${folder}.`)) {
        throw new Error(`${path} has the view ${id}, but its folder is "${folder}".`);
      }
      if (ids.has(id)) throw new Error(`${path} has two views named ${id}.`);
      ids.add(id);
    }
    return feature.views ?? [];
  });
}
