import { CopyRoute, Problem } from '@lo/ui';
import type { FileProblem, RenderProblem } from '@lo/ui/code';
import { runControl } from '@lo/ui/commands';
import { createRoot } from 'react-dom/client';

import { client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';

const copy = (text: string) => client(tabs).copy({ text });

/**
 * Draws a file's `Problem` where the diff view holds it, under the file's header: the shared one,
 * inline, whose "Try again" runs its command on the file as the header's own controls do.
 */
export const renderProblem: RenderProblem = (host, problem, file) => {
  const root = createRoot(host);
  const draw = (now: FileProblem) =>
    root.render(
      // Its own root, outside the window's, so it copies through its own route.
      <CopyRoute copy={copy}>
        <Problem
          title={now.title}
          reason={now.reason}
          details={now.details}
          action={{
            label: 'Try again',
            onClick: () => runControl(now.command, { kind: 'header', file, side: 'new' }),
          }}
        />
      </CopyRoute>,
    );
  draw(problem);
  return {
    update: draw,
    // Not while React may be rendering, as when the view is taken down in an effect.
    destroy: () => queueMicrotask(() => root.unmount()),
  };
};
