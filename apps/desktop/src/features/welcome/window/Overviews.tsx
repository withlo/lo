// The welcome's fourth step: what an overview is. Two lines on what one is and who writes it, the
// top of one as the overview feature draws it, and the settings that follow, as Settings has them:
// whether there are overviews, and what a pull request's tab opens on. They come from the features
// that own them, through the `welcome.overviewRows` slot. Focus starts on the foot's Continue, so
// `⏎` never turns overviews off.

import { SetupList } from '@lo/ui';
import { useId, type ReactNode } from 'react';

import { Slot } from '../../../window/slots.tsx';
import { OverviewExample } from '../../overview/window/shared.ts';
import { StepHeading } from './Heading.tsx';
import { overviewRows } from './shared.ts';

export function OverviewsStep(): ReactNode {
  const heading = useId();
  return (
    <>
      <StepHeading
        id={heading}
        title="An overview explains a pull request"
        line={
          <>
            A document that comes with a pull request. It says what changed and where to look.
            <br />A coding agent writes it. The overview skill teaches Claude Code and Codex how.
          </>
        }
      />
      <div className="flex flex-col gap-16">
        <OverviewExample />
        <div className="flex flex-col gap-8">
          <SetupList labelledBy={heading}>
            <Slot slot={overviewRows} props={{}} />
          </SetupList>
          <p className="m-0 text-fg-muted text-small">Both are also in Settings › Pull requests.</p>
        </div>
      </div>
    </>
  );
}
