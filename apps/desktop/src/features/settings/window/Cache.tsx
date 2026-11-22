// Settings' Storage rows: how much room the cache takes against its limit, with "Clear cache", and
// the limit itself.

import { Button, formatBytes, Input, Meter, Problem, Setting } from '@lo/ui';
import { useCallback, useEffect, useState } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract, type CacheUsage } from '../contract.ts';
import { cacheCap, CACHE_CAP_MAX, GB } from '../settings.ts';
import { wholeNumber } from './format.ts';
import { defineRow, settingRow, useSetting, type ControlProps } from './shared.ts';

/** The size limit, in GB, as a field: what's typed counts when the field is left or `⏎` is pressed. */
function SizeLimit({ value, change, note }: ControlProps<number>) {
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft === undefined) return;
    const gb = wholeNumber(draft);
    const wrong = gb === undefined || gb < 1 || gb > CACHE_CAP_MAX;
    setInvalid(wrong);
    note(
      wrong ? `Use a whole number from 1 to ${CACHE_CAP_MAX.toLocaleString('en-US')}.` : undefined,
    );
    if (wrong) return;
    setDraft(undefined);
    if (gb !== value) change(gb);
  };

  return (
    <>
      <div className="w-64">
        <Input
          mono
          inputMode="numeric"
          aria-label="Size limit in GB"
          invalid={invalid}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      </div>
      <span className="text-fg-muted text-ui" aria-hidden="true">
        GB
      </span>
    </>
  );
}

/** How many times, a second apart, Settings asks again while Lo is still opening the cache. */
const OPENING_TRIES = 30;

/** How full the cache is, under its row: a meter and its numbers, or why there's none. */
function Usage({
  usage,
  cap,
  gaveUp,
}: {
  usage: CacheUsage | undefined;
  cap: number;
  gaveUp: boolean;
}) {
  if (usage === undefined) return <span className="text-fg-muted text-small">Measuring…</span>;
  if (usage.status === 'checking') {
    return (
      <span className="text-fg-muted text-small">
        {gaveUp ? 'Can’t open the cache folder. Restart Lo to try again.' : 'Looking for Git…'}
      </span>
    );
  }
  if (usage.status === 'unavailable') {
    return <span className="text-fg-muted text-small">No local copies</span>;
  }
  const limit = cap * GB;
  return (
    <div className="flex items-center gap-12">
      <div className="min-w-0 flex-1">
        <Meter value={usage.used} max={limit} label="Room the local copies take" />
      </div>
      <span className="flex-none text-fg-muted tabular-nums text-small">
        {formatBytes(usage.used)} of {formatBytes(limit)}
      </span>
    </div>
  );
}

/** The cache's row: what it holds, how full it is, and "Clear cache". */
function Cache({ label, description }: { label: string; description: string }) {
  const cap = useSetting(cacheCap);
  const [usage, setUsage] = useState<CacheUsage>();
  const [tries, setTries] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [kept, setKept] = useState(0);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    client(contract)
      .cacheUsage()
      .then(setUsage, (error: unknown) => {
        console.error("Lo couldn't measure the cache:", error);
        // Better to say there are no copies to show than to go on saying it's measuring them.
        setUsage({ status: 'unavailable' });
      });
  }, []);
  useEffect(refresh, [refresh]);
  // Lo looks for git once its window is up and opens the cache after, so Settings may be first.
  useEffect(() => {
    if (usage?.status !== 'checking' || tries >= OPENING_TRIES) return undefined;
    const timer = setTimeout(() => {
      setTries(tries + 1);
      refresh();
    }, 1000);
    return () => clearTimeout(timer);
  }, [usage, tries, refresh]);

  const clear = async () => {
    setClearing(true);
    setFailed(false);
    try {
      setKept((await client(contract).clearCache()).kept);
    } catch (error) {
      console.error("Lo couldn't clear the cache:", error);
      setFailed(true);
    } finally {
      setClearing(false);
      refresh();
    }
  };

  return (
    <Setting
      label={label}
      description={description}
      below={
        <div className="flex flex-col gap-8">
          <Usage usage={usage} cap={cap} gaveUp={tries >= OPENING_TRIES} />
          {kept > 0 && !failed && (
            <span role="status" className="text-fg-muted text-small">
              {kept === 1
                ? '1 local copy is in use and wasn’t cleared.'
                : `${kept} local copies are in use and weren’t cleared.`}
            </span>
          )}
          {failed && (
            <Problem
              title="Couldn’t clear the cache"
              action={{ label: 'Try again', onClick: () => void clear() }}
            />
          )}
        </div>
      }
    >
      <Button busy={clearing} working="Clearing…" align="end" onClick={() => void clear()}>
        Clear cache
      </Button>
    </Setting>
  );
}

export default [
  defineRow({
    id: 'settings.cache',
    group: 'storage',
    order: 10,
    label: 'Cache',
    description: 'Local copies of repos and data saved from GitHub, so pull requests open fast.',
    words: () => ['clear', 'local copies', 'git'],
    render: Cache,
  }),
  settingRow(cacheCap, { order: 20, control: SizeLimit }),
];
