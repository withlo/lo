// What a pull request's header says when the tab opened it without signing in: it's read only, and
// its revisions, which only GitHub's API for signed-in accounts gives, wait for an account.

import { Button } from '@lo/ui';

import { signIn } from '../../accounts/window/shared.ts';
import { usePull, type PullTab } from '../../tab/window/shared.ts';

export function ReadOnly({ tab }: { tab: PullTab }) {
  const view = usePull(tab.id);
  if (view?.acting?.kind !== 'anonymous') return null;
  return (
    <span className="inline-flex items-center gap-6 text-fg-muted text-small">
      Read only
      <Button size="sm" variant="ghost" onClick={signIn}>
        Sign in to see revisions
      </Button>
    </span>
  );
}
