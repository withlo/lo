// What an overview written for an older push than the head on screen shows above its text: the
// banner, from the overview's first frame, saying what it was written for and where the pull
// request is, then how many files changed since as the local copy tells, with Compare; and the
// Compare button a code block's flag has too. The prompt that brings it up to date is `ya`'s, and
// on a block's menu.

import { Button, Glyphs } from '@lo/ui';
import { OutOfDate } from '@lo/ui/overview';
import { useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { useLocalCopy, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { sinceCount } from './since.ts';
import { compareState, labelOf, staleWords } from './stale.ts';
import { revisions } from './store.ts';

/** Compares revision `from` with `to` in tab `tab`, then shows the diff, which shows it. */
async function compareSince(tab: string, from: string, to: string): Promise<void> {
  try {
    await client(revisionsContract).compare({ id: tab, from, to });
  } catch (error) {
    console.error("Lo couldn't compare the revisions:", error);
    return;
  }
  showDiff(tab);
}

/**
 * "Compare r3 → r5": the overview's commit, `from`, with the head on screen, `to`, in the diff.
 * It's there whether or not it can compare yet, so nothing moves as the revisions come, dimmed
 * with why while it can't.
 */
export function CompareButton({ tab, from, to }: { tab: string; from: string; to: string }) {
  const known = useTabState(revisions, tab);
  const state = compareState(known, from, to);
  return (
    <Button
      size="sm"
      disabled={!state.ok}
      hint={state.ok ? undefined : state.why}
      onClick={() => {
        if (state.ok) void compareSince(tab, from, to);
      }}
    >
      <span>
        <Glyphs text={`Compare ${labelOf(known, from)} → ${labelOf(known, to)}`} />
      </span>
    </Button>
  );
}

/** How many files changed since, for one commit and head, once it's known. */
interface Counted {
  readonly key: string;
  readonly files?: number | null | undefined;
}

/**
 * How many files the pushes since `commit` changed up to `head`, as it comes in once the local
 * copy has the head (`ready`): nothing until then, and `null` when they couldn't be compared.
 */
function useFilesSince(
  tab: string,
  commit: string,
  head: string,
  ready: boolean,
): number | null | undefined {
  const key = `${commit} ${head}`;
  const [counted, setCounted] = useState<Counted>({ key });
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    void sinceCount(tab, commit, head).then((reply) => {
      if (live && reply.kind === 'read') setCounted({ key, files: reply.files });
    });
    return () => {
      live = false;
    };
  }, [tab, commit, head, key, ready]);
  return counted.key === key ? counted.files : undefined;
}

/**
 * The banner over an overview written for `commit`, which isn't `head`, the head on screen: from
 * its first frame, as tall as it stays, how many files changed filling in as the local copy tells.
 */
export function OutOfDateBanner({
  tab,
  commit,
  head,
}: {
  tab: PullTab;
  commit: string;
  head: string;
}) {
  const known = useTabState(revisions, tab.id);
  const local = useLocalCopy(tab.id);
  const ready = local?.kind === 'ready' && local.head === head;
  const files = useFilesSince(tab.id, commit, head, ready);
  const { title, detail } = staleWords({
    written: labelOf(known, commit),
    now: labelOf(known, head),
    files,
  });
  return (
    <OutOfDate
      title={title}
      detail={detail}
      actions={<CompareButton tab={tab.id} from={commit} to={head} />}
    />
  );
}
