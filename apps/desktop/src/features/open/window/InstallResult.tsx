// What the last install of the `lo` command a row asked for left to say under the row: the folder
// to add to `PATH`, or why it failed. Settings' row and the welcome's both show it.

import { Problem } from '@lo/ui';
import type { ReactNode } from 'react';

import type { Installed } from '../contract.ts';
import { installCommand } from './command.ts';

/** `lo`, as code. */
const LO = <span className="code-small">lo</span>;

/** `done`, what main did, or `undefined` when it couldn't be asked: nothing once it's on `PATH`. */
export function InstallResult({ done }: { done: Installed | undefined }): ReactNode {
  if (done?.kind === 'installed') {
    if (done.onPath) return null;
    return (
      <p className="m-0 text-fg-muted text-small">
        Add{' '}
        <span className="break-all text-fg code-small">
          {done.path.slice(0, done.path.lastIndexOf('/'))}
        </span>{' '}
        to your <span className="text-fg code-small">PATH</span>.
      </p>
    );
  }
  const title = <>Couldn’t install the {LO} command</>;
  if (done?.kind === 'taken') {
    return (
      <Problem
        title={title}
        reason={<>Another {LO} file is already there.</>}
        details={done.path}
      />
    );
  }
  return (
    <Problem
      title={title}
      details={done?.message}
      action={{ label: 'Try again', onClick: () => void installCommand('row') }}
    />
  );
}
