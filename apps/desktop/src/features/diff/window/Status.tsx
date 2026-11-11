// What the status bar says of a pull request's tab's diff: that it's GitHub's until the local copy
// replaces it, that GitHub listed only some files, how far diffing has got, and that changes to
// whitespace alone are hidden.

import { StatusItem } from '@lo/ui';
import { useCallback, useSyncExternalStore } from 'react';

import type { PullTab } from '../../tab/window/shared.ts';
import { loaderOf } from './tabs.ts';

export function DiffStatus({ tab }: { tab: PullTab }) {
  const loader = loaderOf(tab.id);
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  const { ready, progress, state, whitespace } = useSyncExternalStore(subscribe, () =>
    loader.snapshot(),
  );
  return (
    <>
      {ready?.from === 'github' && (
        <StatusItem dot="busy" title="The local copy’s diff replaces it once it’s ready.">
          GitHub’s diff
        </StatusItem>
      )}
      {state?.partial && (
        <StatusItem dot="warn" title="GitHub lists 3,000 changed files at most.">
          Some files left out
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
