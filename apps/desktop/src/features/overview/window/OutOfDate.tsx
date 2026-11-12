// What an overview written for an older push than the head on screen shows above its text: the
// banner, from the overview's first frame, saying what it was written for and where the pull
// request is, then how much changed since as the local copy tells, with Compare and the prompt to
// bring it up to date; and the Compare button a code block's flag has too.

import type { CodeRange } from '@lo/artifact';
import { Button, Key } from '@lo/ui';
import { OutOfDate } from '@lo/ui/overview';
import { useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { useLocalCopy, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { copyPrompt, promptFor } from './copy.ts';
import type { Standing } from './facts.ts';
import { keyOf } from './labels.ts';
import { blocksChanged, sinceCount } from './since.ts';
import { compareState, labelOf, pushesSince, staleWords } from './stale.ts';
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
 * It's there whether or not it can compare yet, so nothing moves as the revisions come, and says
 * why when it can't.
 */
export function CompareButton({
  tab,
  from,
  to,
  variant,
}: {
  tab: string;
  from: string;
  to: string;
  variant?: 'ghost' | undefined;
}) {
  const known = useTabState(revisions, tab);
  const state = compareState(known, from, to);
  return (
    <Button
      size="sm"
      variant={variant}
      aria-disabled={state.ok ? undefined : true}
      title={state.ok ? undefined : state.why}
      onClick={() => {
        if (state.ok) void compareSince(tab, from, to);
      }}
    >
      Compare {labelOf(known, from)} → {labelOf(known, to)}
    </Button>
  );
}

/** The two squares of a copy. */
function CopyIcon() {
  return (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.75 5.25V3.5c0-.69-.56-1.25-1.25-1.25H3.5c-.69 0-1.25.56-1.25 1.25v6c0 .69.56 1.25 1.25 1.25h1.75" />
    </svg>
  );
}

/** "Copy prompt for an agent", with `ya`: the prompt to bring the overview up to date. */
function CopyPrompt({ prompt }: { prompt: string | undefined }) {
  const [copied, setCopied] = useState(false);
  const keys = keyOf('overview.copyPrompt');
  return (
    <Button
      size="sm"
      aria-disabled={prompt === undefined ? true : undefined}
      onClick={() => {
        if (prompt === undefined) return;
        copyPrompt(prompt)
          .then(() => setCopied(true))
          .catch((error: unknown) => console.error("Lo couldn't copy the prompt:", error));
      }}
    >
      <CopyIcon />
      {copied ? 'Copied' : 'Copy prompt for an agent'}
      {keys !== undefined && <Key keys={keys} quiet decorative />}
    </Button>
  );
}

/** What's known of what changed since, for one commit and head, and for one set of targets. */
interface Counted {
  readonly key: string;
  readonly targets: readonly CodeRange[];
  readonly files?: number | null | undefined;
  readonly blocks?: number | undefined;
}

/**
 * How many files the pushes since `commit` changed up to `head`, and how many of `targets` point
 * at lines that changed, as each comes in once the local copy has the head (`ready`). What was
 * counted of other targets isn't said of these.
 */
function useCounted(
  tab: string,
  commit: string,
  head: string,
  ready: boolean,
  targets: readonly CodeRange[],
): Omit<Counted, 'key' | 'targets'> {
  const key = `${commit} ${head}`;
  const [counted, setCounted] = useState<Counted>({ key, targets });
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    const take = (found: Omit<Counted, 'key' | 'targets'>) => {
      if (!live) return;
      setCounted((current) => {
        if (current.key !== key) return { key, targets, ...found };
        if (current.targets !== targets) {
          return { key, targets, files: current.files, ...found };
        }
        return { ...current, ...found };
      });
    };
    void sinceCount(tab, commit, head).then((reply) => {
      if (reply.kind === 'read') take({ files: reply.files });
    });
    void blocksChanged(tab, commit, head, targets).then((blocks) => take({ blocks }));
    return () => {
      live = false;
    };
  }, [tab, commit, head, key, ready, targets]);
  if (counted.key !== key) return {};
  return counted.targets === targets ? counted : { files: counted.files };
}

/**
 * The banner over an overview whose commit isn't `head`, the head on screen: from its first frame,
 * as tall as it stays, its counts filling in as the local copy tells them. `targets` are the lines
 * its code blocks show.
 */
export function OutOfDateBanner({
  tab,
  standing,
  head,
  targets,
}: {
  tab: PullTab;
  standing: Extract<Standing, { kind: 'shown' }>;
  head: string;
  targets: readonly CodeRange[];
}) {
  const known = useTabState(revisions, tab.id);
  const local = useLocalCopy(tab.id);
  const commit = standing.header.commit;
  const ready = local?.kind === 'ready' && local.head === head;
  const counted = useCounted(tab.id, commit, head, ready, targets);
  const { title, detail } = staleWords({
    written: labelOf(known, commit),
    now: labelOf(known, head),
    pushes: pushesSince(known, commit, head),
    files: counted.files,
    blocks: targets.length > 0 ? counted.blocks : undefined,
  });
  return (
    <OutOfDate
      title={title}
      detail={detail}
      actions={
        <>
          <CompareButton tab={tab.id} from={commit} to={head} />
          <CopyPrompt prompt={promptFor(tab, standing)} />
        </>
      }
    />
  );
}
