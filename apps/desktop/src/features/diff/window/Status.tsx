// What the status bar says of a pull request's tab's diff: that it's GitHub's until the local copy
// replaces it, that GitHub listed only some files, that it couldn't compare a stack's layer, or a
// run of its layers, with the layer below, how far diffing has got, and that changes to whitespace alone are hidden.

import { StatusItem } from '@lo/ui';
import { useCallback, useSyncExternalStore } from 'react';

import { useLocalCopy, type PullTab } from '../../tab/window/shared.ts';
import { loaderOf } from './tabs.ts';

export function DiffStatus({ tab }: { tab: PullTab }) {
  const loader = loaderOf(tab.id);
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  const { ready, progress, state, whitespace } = useSyncExternalStore(subscribe, () =>
    loader.snapshot(),
  );
  // Without git, what GitHub says is all there is.
  const later = useLocalCopy(tab.id)?.kind === 'noGit' ? '' : ' until the local copy is ready';
  return (
    <>
      {ready?.from === 'github' && (
        <StatusItem dot="busy" title="The local copy’s diff replaces it once it’s ready.">
          GitHub’s diff
        </StatusItem>
      )}
      {state?.partial && (
        <StatusItem
          dot="warn"
          title={
            state.compareFrom === null
              ? 'GitHub lists 3,000 changed files at most.'
              : `GitHub’s comparison with the layer below ${tab.run ? 'the run ' : ''}lists 300 changed files at most, so the rest are left out${later}.`
          }
        >
          Some files left out
        </StatusItem>
      )}
      {state?.uncompared && ready?.from === 'github' && (
        <StatusItem
          dot="warn"
          title={`GitHub couldn’t compare ${tab.run ? 'this run' : 'this layer'} with the layer below it, so its diff includes the layers below${later}.`}
        >
          Layers below included
        </StatusItem>
      )}
      {ready && progress.done < progress.of && (
        <StatusItem>
          Diffing {progress.done} of {progress.of}
        </StatusItem>
      )}
      {!whitespace && ready?.from === 'local' && (
        <StatusItem dot="idle">Whitespace hidden</StatusItem>
      )}
    </>
  );
}
