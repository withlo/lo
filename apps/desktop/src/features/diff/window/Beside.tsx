// One file of a pull request's tab's diff, beside another view, such as the overview's code beside
// it: the comparison on screen, inline, with the line it's asked for near its top. It's drawn from
// the tab's diff as loaded, the same file the diff draws, once what's been worked out of it is in.
// Afterwards, highlighting and anything the reader asks for, such as a file kept out loaded with
// `za`, go into it in place; lines the local copy brings go in only where they draw the same rows,
// so nothing on screen moves without the reader, and otherwise wait until it's drawn again. While it
// has focus, the diff's keys act on it.

import { createDiffView, type DiffFile, type DiffView, type Place } from '@lo/ui/code';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { useViewedMarks, viewedMarkOf, type Mark } from '../../revisions/window/shared.ts';
import { useSetting } from '../../settings/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import { whitespace as whitespaceSetting } from '../settings.ts';
import { diffFileOf, headerOf, shownPath } from './files.ts';
import { keyOf, type Entry, type Loader, type Shown } from './loader.ts';
import { usePage } from './page.ts';
import { loaderOf, setBeside, useSnapshot } from './tabs.ts';
import { changeAt } from './whole.ts';

/** How far below the top of the code the line asked for sits, in pixels: a few lines. */
const LEAD = 48;

export interface BesideProps {
  tab: PullTab;
  /** The file's path, at the head the diff shows. */
  path: string;
  /** Its line to show near the top, at the head the diff shows, or none for its top. */
  line: number | undefined;
  /** What goes at the end of its bar: the way back to the view it's beside. */
  end?: ReactNode;
  /** What goes under its bar: what the diff compares, as it's said over the diff. */
  note?: ReactNode;
}

/** The file at `path` in tab `tab`'s diff, inline, under a bar that names it. */
export function Beside({ tab, path, line, end, note }: BesideProps) {
  const loader = loaderOf(tab.id);
  const { state } = useSnapshot(loader);
  const whitespace = useSetting(whitespaceSetting);
  // The diff loads once it knows whether whitespace shows, whether or not it's been drawn.
  useEffect(() => loader.setWhitespace(whitespace === 'show'), [loader, whitespace]);
  const files = state?.files;
  const change = changeAt(files, path);
  const slash = path.lastIndexOf('/');
  const shown = shownPath(path);
  return (
    <div className="flex h-full min-h-0 flex-col" data-lo-beside={tab.id}>
      <div className="lo-split__bar">
        <span className="lo-path" title={path}>
          {slash < 0 || shown !== path ? (
            shown
          ) : (
            <>
              {path.slice(0, slash + 1)}
              <b>{path.slice(slash + 1)}</b>
            </>
          )}
        </span>
        <span className="flex-none">Inline</span>
        <span className="min-w-8 flex-1" />
        {end}
      </div>
      {note}
      {change && state?.at ? (
        <Code
          key={`${state.at}|${state.comparison ?? ''}|${keyOf(change)}`}
          tab={tab}
          loader={loader}
          entry={{
            place: files?.indexOf(change) ?? 0,
            versions: change,
            key: keyOf(change),
            id: loader.ids.of(keyOf(change)),
          }}
          line={line}
        />
      ) : (
        <Said>
          {!files
            ? 'Reading what the pull request changes…'
            : state?.comparison === null
              ? `This pull request doesn’t change ${shownPath(path)}.`
              : `${shownPath(path)} didn’t change between these revisions.`}
        </Said>
      )}
    </div>
  );
}

/** What shows in the code's place. */
function Said({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-bg p-32 text-center text-fg-muted text-ui">
      <p className="m-0 max-w-read-measure">{children}</p>
    </div>
  );
}

/** Whether the view can be drawn with what's been worked out of the file, `shown`. */
function drawable(entry: Entry, shown: Shown | undefined): boolean {
  const { start } = entry.versions;
  return shown !== undefined || (start !== 'shown' && start !== 'collapsed');
}

/** The file as the view is given it: open, whatever it starts as in the diff. */
function fileOf(entry: Entry, shown: Shown | undefined, mark: Mark | undefined): DiffFile {
  const file = diffFileOf(entry, shown, mark);
  delete file.collapsed;
  return file;
}

/** The file's code: drawn once there's something to draw, then kept up to date in place. */
function Code({
  tab,
  loader,
  entry,
  line,
}: {
  tab: PullTab;
  loader: Loader;
  entry: Entry;
  line: number | undefined;
}) {
  const page = usePage();
  const marks = useViewedMarks(tab.id);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<DiffView>(undefined);
  const { id, versions } = entry;
  const { id: tabId, owner, repo, number } = tab;
  // Drawn once there's something to draw. The component is the file's, in one comparison.
  const [ready, setReady] = useState(() => drawable(entry, loader.shown(id)));
  const latest = useRef({ entry, marks });
  latest.current = { entry, marks };
  useEffect(() => {
    if (ready) return undefined;
    const check = () => {
      if (drawable(latest.current.entry, loader.shown(id))) setReady(true);
    };
    check();
    return loader.onFile((changed) => {
      if (changed === id) check();
    });
  }, [loader, id, ready]);

  useLayoutEffect(() => {
    const parent = box.current;
    if (!parent || !page || !ready) return undefined;
    const keys = registry();
    const { entry: drawnEntry, marks: drawnMarks } = latest.current;
    let drawnShown = loader.shown(id);
    /** The reader asked for the file's lines, with `za`: whatever comes goes in. */
    let asked = false;
    const mark = viewedMarkOf(drawnMarks, drawnEntry.versions.path, drawnEntry.versions.previous);
    const made = createDiffView(
      parent,
      {
        files: [fileOf(drawnEntry, drawnShown, mark)],
        layout: 'inline',
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      {
        cursor() {},
        mode() {},
        file() {},
        // Beside another view, a jump stays its own: the tab's history is the view it's beside.
        jumped() {},
        load(file) {
          asked = true;
          loader.load(file);
        },
        menu: (target, x, y) => {
          openMenu(target, { x, y });
        },
      },
    );
    view.current = made;
    /** Takes what's been worked out of the file since it was drawn. */
    const take = () => {
      const now = loader.shown(id);
      if (now === drawnShown) return;
      if (now === undefined) return;
      const before = drawnShown;
      if (before === undefined) {
        // A file kept out, loaded as the reader asked.
        if (!asked) return;
        drawnShown = now;
        made.setLines(id, now.lines, now.diff);
      } else if (now.lines === before.lines) {
        drawnShown = now;
        if (now.diff !== before.diff) made.setDiff(id, now.diff);
      } else if (made.keepsShape(id, now.lines, now.diff)) {
        drawnShown = now;
        made.setLines(id, now.lines, now.diff);
      } else {
        // Drawn again, it shows them: until then, what's on screen stays.
        return;
      }
      if (now.tokens.old) made.setTokens(id, 'old', now.tokens.old);
      if (now.tokens.new) made.setTokens(id, 'new', now.tokens.new);
    };
    const stops = [
      loader.onFile((changed) => {
        if (changed !== id) return;
        if (loader.failed(id) && asked) {
          made.loadFailed(id);
          return;
        }
        take();
      }),
      keys.subscribe(() => made.setVimKeys(keys.vimKeys())),
      setBeside(tabId, {
        holds: (element) => element !== null && parent.contains(element),
        drawn: {
          view: made,
          loader,
          tab: tabId,
          pull: { owner, repo, number },
          order: [id],
          beside: true,
          acted() {},
          fileAt: () => id,
          toTop: (file) => made.revealAtTop({ kind: 'file', file }),
          viewedHere(file, viewed) {
            made.setCollapsed(file, viewed);
          },
        },
      }),
    ];
    take();
    return () => {
      for (const stop of stops) stop();
      view.current = undefined;
      made.destroy();
    };
    // Drawn once it can be: another file or comparison is another component.
  }, [page, ready, loader, id, tabId, owner, repo, number]);

  // The line asked for near the top, the cursor on it: as the code is drawn, and for each block.
  useLayoutEffect(() => {
    const made = view.current;
    if (!made) return;
    if (line === undefined) {
      made.reveal({ kind: 'file', file: id });
      return;
    }
    const at: Place = { file: id, side: 'new', line };
    if (!made.reveal({ kind: 'line', at })) return;
    made.scrollTo({ at: { kind: 'line', at }, offset: -LEAD });
  }, [id, line, page, ready]);

  // The header's viewed mark, as it changes.
  useEffect(() => {
    const mark = viewedMarkOf(marks, versions.path, versions.previous);
    view.current?.setHeader(id, headerOf(versions, mark));
  }, [marks, id, versions]);

  if (!page || !ready) {
    return <Said>Diffing the file…</Said>;
  }
  return <div ref={box} className="min-h-0 flex-1" data-lo-beside-code={id} />;
}
