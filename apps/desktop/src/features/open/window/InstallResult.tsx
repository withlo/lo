// What the last install of the `lo` command a row asked for left to say under the row: the folder
// to add to `PATH`, or why it failed. Settings' row and the welcome's both show it.

import { Problem, Ticks, WholePath } from '@lo/ui';
import type { ReactNode } from 'react';

import type { Installed } from '../contract.ts';
import { folderOf, installCommand, NOT_INSTALLED, notInstalledReason } from './command.ts';

/** `done`, what main did, or `undefined` when it couldn't be asked: nothing once it's on `PATH`. */
export function InstallResult({ done }: { done: Installed | undefined }): ReactNode {
  if (done?.kind === 'installed') {
    if (done.onPath) return null;
    return (
      <p className="m-0 text-fg-muted text-small">
        Add <WholePath path={folderOf(done.path)} className="text-fg code-small" /> to{' '}
        <span className="text-fg code-small">PATH</span>.
      </p>
    );
  }
  const title = <Ticks text={NOT_INSTALLED} />;
  if (done?.kind === 'taken') {
    return (
      <Problem
        title={title}
        reason={<Ticks text={notInstalledReason(done)} />}
        details={done.path}
      />
    );
  }
  return (
    <Problem
      title={title}
      reason={done === undefined ? undefined : <Ticks text={notInstalledReason(done)} />}
      details={done?.details}
      action={{ label: 'Try again', onClick: () => void installCommand('row') }}
    />
  );
}
