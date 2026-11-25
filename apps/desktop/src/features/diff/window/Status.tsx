// What the status bar says of a pull request's tab's diff: that it's GitHub's until the local copy
// replaces it, that GitHub listed only some files, that it couldn't compare a stack's layer, or a
// run of its layers, with the layer below, how far diffing has got, and that changes to whitespace
// alone are hidden. A click on each opens its details: what it means for the diff, and for
// whitespace, the button that shows those changes again.

import { Button, StatusActions, StatusItem, StatusLine, useControl } from '@lo/ui';
import { NO_TARGET, runControl } from '@lo/ui/commands';
import { useCallback, useSyncExternalStore } from 'react';

import type { PullTab } from '../../tab/window/shared.ts';
import { loaderOf } from './tabs.ts';

/** Where an item's details are put in the page: inside `.lo-app`. */
function container(): HTMLElement | null {
  return document.getElementById('root');
}

/** What GitHub lists of a diff past its limit: 3,000 files of a pull request, 300 of a comparison. */
function first(compareFrom: string | null): string {
  return compareFrom === null ? 'First 3,000 files shown' : 'First 300 files shown';
}

/** What a diff from GitHub waits for, which says what it's missing. */
const ONCE = 'once the local copy is ready.';

/** The details of "Whitespace changes hidden": the setting holds everywhere, and its switch. */
function Whitespace() {
  const control = useControl('diff.whitespace', NO_TARGET);
  return (
    <>
      <StatusLine>Hidden in every pull request.</StatusLine>
      <StatusActions>
        <Button
          variant="secondary"
          size="sm"
          hint="Show whitespace changes"
          hintKeys={control?.keys}
          hintShortcut={control?.shortcut}
          onClick={() => runControl('diff.whitespace', NO_TARGET)}
        >
          Show whitespace changes
        </Button>
      </StatusActions>
    </>
  );
}

export function DiffStatus({ tab }: { tab: PullTab }) {
  const loader = loaderOf(tab.id);
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  const { ready, progress, state, whitespace } = useSyncExternalStore(subscribe, () =>
    loader.snapshot(),
  );
  return (
    <>
      {ready?.from === 'github' && (
        <StatusItem
          ball="warn"
          container={container()}
          details={<StatusLine>Shown until the local copy is ready.</StatusLine>}
        >
          GitHub’s diff
        </StatusItem>
      )}
      {state?.partial && (
        <StatusItem
          ball="warn"
          container={container()}
          details={<StatusLine>The rest show {ONCE}</StatusLine>}
        >
          {first(state.compareFrom)}
        </StatusItem>
      )}
      {ready?.uncompared &&
        (tab.run ? (
          <StatusItem
            ball="warn"
            container={container()}
            details={<StatusLine>The layers show as one diff {ONCE}</StatusLine>}
          >
            Showing #{tab.number} alone
          </StatusItem>
        ) : (
          <StatusItem
            ball="warn"
            container={container()}
            details={
              <StatusLine>
                #{tab.number}’s own changes show {ONCE}
              </StatusLine>
            }
          >
            Layers below included
          </StatusItem>
        ))}
      {ready && progress.done < progress.of && (
        <StatusItem
          ball="working"
          container={container()}
          details={
            <StatusLine>
              Diffing #{tab.number} · {progress.done} of {progress.of} files
            </StatusLine>
          }
        >
          Diffing files · {progress.done} of {progress.of}
        </StatusItem>
      )}
      {!whitespace && ready?.from === 'local' && (
        <StatusItem ball="off" container={container()} details={<Whitespace />}>
          Whitespace changes hidden
        </StatusItem>
      )}
    </>
  );
}
