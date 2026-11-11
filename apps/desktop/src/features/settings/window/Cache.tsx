import { Button, Input, Meter, Setting } from '@lo/ui';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract, type CacheUsage } from '../contract.ts';
import { cacheCap, CACHE_CAP_MAX, GB } from '../settings.ts';
import { formatBytes, wholeNumber } from './format.ts';
import { changeSetting, defineSection, useSetting } from './shared.ts';

/** The size limit, in GB, as a field: what's typed counts when the field is left or `⏎` is pressed. */
function SizeLimit() {
  const cap = useSetting(cacheCap);
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const said = useId();

  const commit = () => {
    if (draft === undefined) return;
    const gb = wholeNumber(draft);
    if (gb === undefined || gb < 1 || gb > CACHE_CAP_MAX) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(undefined);
    if (gb !== cap) void changeSetting(cacheCap, gb);
  };

  return (
    <Setting
      label="Size limit"
      description={
        invalid ? (
          <span id={said} className="text-danger">
            Use a whole number of GB, from 1 to {CACHE_CAP_MAX.toLocaleString('en-US')}.
          </span>
        ) : (
          'Past it, Lo removes the least recently used copies.'
        )
      }
    >
      <div className="w-64">
        <Input
          mono
          inputMode="numeric"
          aria-label="Size limit in GB"
          aria-describedby={invalid ? said : undefined}
          invalid={invalid}
          value={draft ?? String(cap)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      </div>
      <span className="text-fg-muted text-ui">GB</span>
    </Setting>
  );
}

/** How much room the local copies take, with the way to clear them. */
function Usage({
  usage,
  cap,
  gaveUp,
  onChanged,
}: {
  usage: CacheUsage | undefined;
  cap: number;
  gaveUp: boolean;
  onChanged: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  const [said, setSaid] = useState<string>();

  const clear = async () => {
    setClearing(true);
    setSaid(undefined);
    try {
      const { kept } = await client(contract).clearCache();
      setSaid(
        kept === 0
          ? 'Cleared.'
          : `Cleared. ${kept === 1 ? '1 copy is' : `${kept} copies are`} in use, and stayed.`,
      );
    } catch (error) {
      console.error("Lo couldn't clear the cache:", error);
      notify('Clear the cache', "Lo couldn't clear the cache.");
    } finally {
      setClearing(false);
      onChanged();
    }
  };

  const ready = usage?.status === 'ready' ? usage : undefined;
  const limit = cap * GB;
  let label: ReactNode = 'No local copies';
  let description = 'Lo keeps them with git, and has none to use right now.';
  if (usage === undefined) {
    label = 'Measuring the cache';
    description = 'Local copies of repos, and answers saved from GitHub.';
  } else if (usage.status === 'checking' && !gaveUp) {
    label = 'Looking for git';
    description = 'Lo keeps its local copies with git.';
  } else if (usage.status === 'checking') {
    description = "Lo couldn't open the folder it keeps them in. Restart Lo to try again.";
  } else if (ready) {
    label = <span className="tabular-nums">{formatBytes(ready.used)}</span>;
    description =
      'Local copies of repos, and answers saved from GitHub. Clearing them means fetching again the next time.';
  }
  return (
    <>
      <Setting label={label} description={description}>
        <Button disabled={clearing} onClick={() => void clear()}>
          Clear the cache
        </Button>
      </Setting>
      {(ready || said !== undefined) && (
        <div className="flex flex-col gap-6 pb-12">
          {ready && <Meter value={ready.used} max={limit} label="Room the local copies take" />}
          <div className="text-fg-muted text-small" role="status">
            {ready && (
              <>
                <span className="tabular-nums">
                  {formatBytes(ready.used)} of {formatBytes(limit)}
                </span>
                .{' '}
              </>
            )}
            {said ?? (ready ? 'Lo removes the oldest copies past that.' : undefined)}
          </div>
        </div>
      )}
    </>
  );
}

/** How many times, a second apart, Settings asks again while Lo is still opening the cache. */
const OPENING_TRIES = 30;

function Cache() {
  const cap = useSetting(cacheCap);
  const [usage, setUsage] = useState<CacheUsage>();
  const [tries, setTries] = useState(0);
  const refresh = useCallback(() => {
    client(contract)
      .cacheUsage()
      .then(setUsage, (error: unknown) => {
        console.error("Lo couldn't measure the cache:", error);
        // Better to say Lo has no copies to show than to go on saying it is measuring them.
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
  return (
    <>
      <Usage usage={usage} cap={cap} gaveUp={tries >= OPENING_TRIES} onChanged={refresh} />
      <SizeLimit />
    </>
  );
}

export default defineSection({
  id: 'settings.cache',
  title: 'Cache',
  description:
    'Local copies of repos and saved answers from GitHub, kept so a pull request opens fast.',
  order: 50,
  render: Cache,
});
