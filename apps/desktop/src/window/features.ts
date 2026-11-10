/** What a feature's `window/index.ts` exports by default. */
export interface WindowFeature {
  /** Runs once, before the window first renders. */
  start?(): void;
}

// Every feature folder with a window side. No file lists them.
const features = import.meta.glob<WindowFeature>('../features/*/window/index.ts', {
  eager: true,
  import: 'default',
});

export function startFeatures(): void {
  for (const feature of Object.values(features)) feature.start?.();
}
