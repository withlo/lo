// What a pull request's header says when the tab opened it without signing in: it's read only, and
// its revisions, which only GitHub's API for signed-in accounts gives, wait for an account. While no
// account is signed in, as the header's "Not signed in" says, the button signs in; while one is, it
// adds another, and says so.

import { Button } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import { signInAsk, useSignedIn } from '../../accounts/window/shared.ts';
import { usePull, type PullTab } from '../../tab/window/shared.ts';

export function ReadOnly({ tab }: { tab: PullTab }) {
  const view = usePull(tab.id);
  const ask = signInAsk('compare revisions', useSignedIn());
  if (view?.acting?.kind !== 'anonymous') return null;
  return (
    <span className="inline-flex items-center gap-6 text-fg-muted text-small">
      Read only
      <Button size="sm" variant="ghost" onClick={() => registry().run(ask.command, NO_TARGET)}>
        {ask.title}
      </Button>
    </span>
  );
}
