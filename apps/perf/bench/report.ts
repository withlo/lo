// The report: `report.json` keeps everything measured; `report.md` shows a table per pull request,
// a row per bar at each width, with the median of the runs, the worst run and whether every run
// met the bar, then the conditions, what each timer starts and stops on, and where the time went
// in the bars that failed.

import { type Bar, bars, judge, type Judged, keyReading, type Reading, zRBar } from './bars.ts';
import type { LongFrameEntry } from './recorder.ts';
import type { Results, RunResult, Width } from './results.ts';
import { type KeyTimes, median, shown } from './stats.ts';

/** The pull requests' names as the report shows them. */
const titles: Record<string, string> = {
  'kubernetes-125488': 'kubernetes/kubernetes#125488',
  'typescript-51387': 'microsoft/TypeScript#51387',
  'typescript-54820': 'microsoft/TypeScript#54820',
};

export function titleOf(pull: string): string {
  return titles[pull] ?? pull;
}

/** A reading as the table shows it, in its unit. */
export function showReading(reading: Reading, unit: Bar['unit']): string {
  if (reading === undefined) return '–';
  if (typeof reading !== 'number') return `< ${reading.under} ms`;
  switch (unit) {
    case 'ms':
      return `${shown(reading, reading >= 100 ? 0 : 1)} ms`;
    case 'px':
      return `${shown(reading, 2)} px`;
    case 'MB':
      return `${shown(reading, 0)} MB`;
    case '%':
      return `${shown(reading, 1)}%`;
    case 'frames':
      return shown(reading, 0);
    default:
      throw new Error(`A unit the report doesn't know: ${JSON.stringify(unit satisfies never)}`);
  }
}

function verdict(result: Judged): string {
  if (result.pass === undefined) return 'not measured';
  return result.pass ? 'pass' : '**fail**';
}

function widthName(width: Width, results: Results): string {
  return width === '1440' ? '1440 px' : `${results.conditions.display.workArea.width} px`;
}

/** Each bar judged for a pull request at a width. */
export function judged(
  results: Results,
  pull: string,
  width: Width,
): { bar: Bar; judged: Judged }[] {
  const runs = results.runs.filter((run) => run.pull === pull && run.width === width);
  return bars.map((bar) => ({
    bar,
    judged: judge(
      runs.map((run) => bar.read(run)),
      bar.limit(pull),
      bar.strict,
    ),
  }));
}

/** Every bar that failed, by pull request and width. */
export function failures(results: Results): { pull: string; width: Width; bar: Bar }[] {
  const failed: { pull: string; width: Width; bar: Bar }[] = [];
  for (const pull of pullsOf(results)) {
    for (const width of widthsOf(results)) {
      for (const { bar, judged: result } of judged(results, pull, width)) {
        if (result.pass === false) failed.push({ pull, width, bar });
      }
    }
  }
  const zR = judge(
    results.zR.map((run) => keyReading(run.keyToPaint, 100)),
    zRBar.limit,
  );
  if (zR.pass === false) {
    failed.push({
      pull: 'typescript-54820',
      width: '1440',
      bar: { ...bars[0]!, id: 'zR', label: zRBar.label },
    });
  }
  return failed;
}

function pullsOf(results: Results): string[] {
  return [...new Set(results.runs.map((run) => run.pull))];
}

function widthsOf(results: Results): Width[] {
  return [...new Set([...results.runs, ...results.zR].map((run) => run.width))];
}

/** The report, with `notes`, written after the runs, under its summary. */
export function reportMarkdown(results: Results, notes?: string): string {
  const { conditions } = results;
  const lines: string[] = [];
  const runCount = Math.max(0, ...results.runs.map((run) => run.run));
  lines.push(
    '# The diff view on large pull requests',
    '',
    `Measured ${conditions.started.slice(0, 10)} at \`${conditions.commit.slice(0, 12)}\`, ` +
      `${runCount} ${runCount === 1 ? 'run' : 'runs'} of each. A bar passes only when every run ` +
      'met it. The median and the worst are of the runs.',
    '',
  );
  if (notes) lines.push(notes.trim(), '');
  for (const pull of pullsOf(results)) {
    lines.push(`## ${titleOf(pull)}`, '');
    const widths = widthsOf(results).filter((width) =>
      results.runs.some((run) => run.pull === pull && run.width === width),
    );
    lines.push(
      '| Metric | Width | Bar | Median | Worst run | Result |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const bar of bars) {
      for (const width of widths) {
        const result = judged(results, pull, width).find((row) => row.bar.id === bar.id)!.judged;
        lines.push(
          `| ${bar.label} | ${widthName(width, results)} | ${bar.shown(pull)} | ${showReading(result.median, bar.unit)} | ${showReading(result.worst, bar.unit)} | ${verdict(result)} |`,
        );
      }
    }
    lines.push('');
    const extra = results.runs.filter((run) => run.pull === pull);
    lines.push(...keysTable(extra, results), '', ...detailsOf(extra, results), '');
  }

  if (results.zR.length > 0) {
    lines.push('## `zR` on `src/compiler/checker.ts`, microsoft/TypeScript#54820', '');
    lines.push('| Width | Bar | Median | Worst run | Result |', '| --- | --- | --- | --- | --- |');
    for (const width of widthsOf(results)) {
      const runs = results.zR.filter((run) => run.width === width);
      if (runs.length === 0) continue;
      const result = judge(
        runs.map((run) => keyReading(run.keyToPaint, 100)),
        zRBar.limit,
      );
      lines.push(
        `| ${widthName(width, results)} | ${zRBar.shown} | ${showReading(result.median, 'ms')} | ${showReading(result.worst, 'ms')} | ${verdict(result)} |`,
      );
    }
    for (const run of results.zR) {
      for (const note of run.notes) lines.push(`- Run ${run.run}, ${run.width}: ${note}`);
    }
    lines.push('');
  }

  const large = results.runs.filter((run) => run.large);
  if (large.length > 0) {
    const path = large[0]!.large!.path;
    lines.push(
      `## Loading \`${path}\` into the document, ${titleOf(large[0]!.pull)}`,
      '',
      'No bar. From `za` asking for the file to the frame after its lines, then its diff, were drawn.',
      '',
      '| Width | Run | Lines drawn | Diff drawn |',
      '| --- | --- | --- | --- |',
    );
    for (const run of large) {
      lines.push(
        `| ${widthName(run.width, results)} | ${run.run} | ${showReading(run.large!.lines, 'ms')} | ${showReading(run.large!.diff, 'ms')} |`,
      );
    }
    lines.push('');
  }

  lines.push(...conditionsOf(results), '', ...timersOf(), '');
  lines.push(
    '## Trying it',
    '',
    'With the files fetched, any of the three opens the same way: ' +
      '`pnpm nx run perf:open -- kubernetes-125488`, `typescript-51387` or `typescript-54820`.',
    '',
  );
  const failed = failures(results);
  if (failed.length > 0) lines.push(...whereTheTimeWent(results, failed), '');
  if (results.traces.length > 0 || results.videos.length > 0) {
    lines.push('## Traces and videos', '');
    lines.push(
      'Traces open in Chrome DevTools’ Performance panel (Load profile) or at ui.perfetto.dev. ' +
        'They come from a separate run, since tracing slows the page: their times aren’t the ' +
        'table’s.',
      '',
    );
    for (const path of [...results.traces, ...results.videos]) lines.push(`- \`${path}\``);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The keys the runs pressed, every press of every run together, with two to compare them with. */
type KeyName = Exclude<keyof RunResult['keys'], 'stretch'>;

const keyRows: { key: KeyName; label: string }[] = [
  { key: 'nextFile', label: '`]f`' },
  { key: 'nextChange', label: '`]c`' },
  { key: 'end', label: '`G`' },
  { key: 'otherSide', label: '`Tab`' },
  { key: 'heldJ', label: 'Held `j`' },
  { key: 'pageDown', label: 'Held PageDown' },
  { key: 'typing', label: 'Typing in a comment box' },
  { key: 'nothing', label: 'Held `Esc`, which changes nothing' },
];

function keysTable(runs: RunResult[], results: Results): string[] {
  const out = [
    'Every key, from its keydown to the next paint (Event Timing), all runs together. The last ' +
      'two have no bar: they show what any key costs in this window.',
    '',
    '| Key | Width | Presses | Median | p95 | Slowest |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const width of widthsOf(results)) {
    const atWidth = runs.filter((run) => run.width === width);
    if (atWidth.length === 0) continue;
    for (const { key, label } of keyRows) {
      const times = atWidth.map((run) => run.keys[key]);
      const joined: KeyTimes = {
        keys: times.reduce((sum, each) => sum + each.keys, 0),
        reported: times.flatMap((each) => each.reported),
        under: times[0]?.under ?? 16,
        parts: [],
      };
      out.push(
        `| ${label} | ${widthName(width, results)} | ${joined.keys} | ` +
          `${showReading(keyReading(joined, 50), 'ms')} | ${showReading(keyReading(joined, 95), 'ms')} | ` +
          `${showReading(keyReading(joined, 100), 'ms')} |`,
      );
    }
  }
  return out;
}

/** What else the runs saw: the document, scroll speeds, readings' cost, notes. */
function detailsOf(runs: RunResult[], results: Results): string[] {
  const out: string[] = [];
  for (const run of runs) {
    const width = widthName(run.width, results);
    out.push(
      `- Run ${run.run} at ${width}: window ${run.inner.width} × ${run.inner.height} px, ` +
        `document ${shown(run.height / 1000, 0)}k px tall. Flings: ${shown(run.fling.scrolled / 1000, 0)}k px in ` +
        `${shown(run.fling.ms / 1000, 1)} s, ${run.fling.frames.frames} frames, ${run.fling.blank.oneSided}/` +
        `${run.fling.blank.undrawn}/${run.fling.blank.past} frames with a row on one side/undrawn/scrolled past what was drawn. ` +
        `PageDown: ${run.pageDown.inputs} presses, ${shown(run.pageDown.ms / 1000, 1)} s, ` +
        `${run.pageDown.blank.oneSided}/${run.pageDown.blank.undrawn}/${run.pageDown.blank.past}. ` +
        `Readings cost ${shown(run.fling.readMs, 2)} ms a frame (p95). ` +
        `Heap ${shown(run.memory.afterLoad.heap, 0)} → ${shown(run.memory.afterFirst.heap, 0)} → ` +
        `${shown(run.memory.afterSecond.heap, 0)} MB; resident ${shown(run.memory.afterLoad.resident, 0)} → ` +
        `${shown(run.memory.afterSecond.resident, 0)} MB. ` +
        `Tab: ${showReading(keyReading(run.keys.otherSide, 100), 'ms')} at the slowest.`,
    );
    for (const note of run.notes) out.push(`  - ${note}`);
  }
  return out;
}

function conditionsOf(results: Results): string[] {
  const { conditions: c } = results;
  const inUse = c.memoryInUse;
  return [
    '## Conditions',
    '',
    `- ${c.machine}, ${c.chip}, ${c.memoryGB} GB of memory, macOS ${c.macOS}.`,
    `- Display: ${c.display.label.trim() || 'the main display'}, ${c.display.width} × ${c.display.height} px ` +
      `at ${c.display.scale}× (${c.display.workArea.width} × ${c.display.workArea.height} px for windows), ` +
      `${shown(c.display.hz, 0)} Hz: a frame is ${shown(1000 / c.display.hz, 1)} ms.`,
    `- Electron ${c.electron}, Chromium ${c.chromium}. GPU compositing ${c.gpu.gpu_compositing ?? 'unknown'}, ` +
      `rasterization ${c.gpu.rasterization ?? 'unknown'}.`,
    `- Memory in use on the machine while it ran: ${shown(Math.min(...inUse), 1)} to ${shown(Math.max(...inUse), 1)} GB.`,
    `- Frames came every ${shown(Math.min(...c.frameCheck), 1)} to ${shown(Math.max(...c.frameCheck), 1)} ms, at the median, with the page idle before each run.`,
    `- The production bundle, run unpackaged with \`--js-flags=--expose-gc\`, from ${c.started} to ${c.finished ?? '–'}.`,
  ];
}

function timersOf(): string[] {
  return [
    '## What each timer starts and stops on',
    '',
    '- **Open to first file painted:** starts when main begins opening the pull request, before it ' +
      'reads the files from disk; stops when the frame after the one that drew the first file with ' +
      'its diff and highlighting begins (`requestAnimationFrame`), about when that frame reaches the ' +
      'screen. It includes starting the window and loading its page, which the app does once, not ' +
      'per pull request. Each step is listed under `open.steps` in `report.json`.',
    '- **All diffs and moves computed:** the same start; stops when the window receives the moves, ' +
      'which the background process sends after the last diff. Main-thread tasks are the Long Tasks ' +
      'API’s, on the window’s main thread, until then.',
    '- **Frames:** the time between one frame’s `requestAnimationFrame` and the next, for every ' +
      'frame from the first input to half a second after the last: the main thread’s frames, which ' +
      'draw the editors. They’re counted in whole refreshes of the display, each rounded to the ' +
      'nearest, since the display’s refreshes come a millisecond or two early or late: a frame that ' +
      'made its refresh is 16.7 ms, one that missed it 33.3 ms. So the bars’ 33 ms is two ' +
      'refreshes, and their 100 ms six. The times as `requestAnimationFrame` gave them are in ' +
      '`report.json` (`raw`). Long Animation Frames entries say what ran in each frame over 50 ms.',
    '- **Flings:** wheel events through the DevTools protocol, which Chromium takes as a mouse’s, ' +
      'one every 16.7 ms with the pointer over the right side, sent on the clock without waiting ' +
      'for the page: starting at 480 px and slowing by 6% an event until under 10 px, about 7,800 px ' +
      'a fling over a second, one fling after another until the scroll stops at the bottom.',
    '- **PageDown:** held, with focus in the right side: a keydown every 33 ms, macOS’s fastest key ' +
      'repeat, sent on the clock without waiting for the page, until the bottom.',
    '- **Blank rows:** a frame counts when, after its layout and before its paint, a row is drawn on ' +
      'one side only, or any part of the screen inside either editor’s content isn’t drawn ' +
      '(CodeMirror’s gaps, or lines the view forgot). While the wheel scrolls, it also counts when ' +
      'the scroll ran further, between one frame and the next, than the first had drawn beyond the ' +
      'screen: the compositor scrolls on its own and shows that much blank until the page draws ' +
      'again. Keys scroll from script, in the frame that draws what they scroll to.',
    '- **Keys:** the Event Timing API’s duration for the keydown that finishes the command (the `f` ' +
      'of `]f`): from the key event’s time to the next paint after its handlers ran, rounded to ' +
      '8 ms. The API reports keys that took 16 ms or more; one it didn’t report took less, shown ' +
      'as “< 16 ms”. `]f` and `]c` are pressed ten times from the top, `G` three times from the ' +
      'top, and `j` held for 150 repeats every 33 ms; the table shows the slowest press, and for ' +
      '`j` the 95th percentile.',
    '- **Alignment:** after every frame’s layout, before its paint, the on-screen top of every ' +
      'row with something on both sides, its first line or the header, collapsed block or note it ' +
      'starts with, on each side, from the view’s probe; the worst difference of any frame, over ' +
      'the keys (comments typed on each side included), the flings and PageDown.',
    '- **Renderer memory:** the window’s renderer process’s resident memory from ' +
      '`app.getAppMetrics()`, at its largest over the run, before any large file is loaded. MB ' +
      'are 1,000,000 bytes.',
    '- **Heap growth:** V8’s used heap after two `gc()` calls, after the flings and again after ' +
      'PageDown, the second full scroll.',
    '- **`zR`:** the keydown of `R` in `zR`, with the cursor in the file, timed as the keys are.',
  ];
}

function whereTheTimeWent(
  results: Results,
  failed: { pull: string; width: Width; bar: Bar }[],
): string[] {
  const out = ['## Where the time went in the bars that failed', ''];
  for (const { pull, width, bar } of failed) {
    out.push(`### ${bar.label}, ${titleOf(pull)}, ${widthName(width, results)}`, '');
    const runs = results.runs.filter((run) => run.pull === pull && run.width === width);
    if (bar.id === 'zR') {
      out.push(...keyParts(results.zR.map((run) => run.keyToPaint)));
      for (const run of results.zR) out.push(...longFramesOf(run.stretch.longFrames, 3));
    } else if (bar.id === 'computed' || bar.id === 'open' || bar.id === 'openTask') {
      for (const run of runs) {
        const steps = Object.entries(run.open.steps)
          .map(([step, ms]) => `${step} ${showReading(ms, 'ms')}`)
          .join('; ');
        out.push(`- Run ${run.run}: ${steps}.`);
        const tasks = run.open.longTasks.map((task) => shown(task.duration, 0));
        if (tasks.length > 0) out.push(`  - Its tasks over 50 ms, in ms: ${tasks.join(', ')}.`);
      }
    } else if (bar.id.endsWith('Blank')) {
      const stretch = bar.id.startsWith('fling') ? 'fling' : 'pageDown';
      for (const run of runs) {
        const { blank, frames } = run[stretch];
        out.push(
          `- Run ${run.run}: ${blank.frames} of ${frames.frames} frames. A row drawn on one side ` +
            `only: ${blank.oneSided}. Part of the screen inside an editor not drawn: ` +
            `${blank.undrawn}. The scroll ran further than the frame before had drawn beyond the ` +
            `screen: ${blank.past}. At worst ${shown(blank.worstPx, 0)} px blank.`,
        );
      }
    } else if (bar.id.startsWith('fling') || bar.id.startsWith('pageDown')) {
      const stretch = bar.id.startsWith('fling') ? 'fling' : 'pageDown';
      for (const run of runs) {
        const { frames, raw } = run[stretch];
        out.push(
          `- Run ${run.run}: ${frames.over16} of ${frames.frames} frames missed a refresh, ` +
            `${frames.over33} missed two or more. As \`requestAnimationFrame\` timed them: p95 ` +
            `${shown(raw.p95)} ms, p99 ${shown(raw.p99)} ms, longest ${shown(raw.max)} ms.`,
        );
      }
      out.push(
        ...longFramesOf(
          runs.flatMap((run) => run[stretch].longFrames),
          5,
        ),
      );
    } else if (isKeyBar(bar.id)) {
      const key = bar.id;
      out.push(...keyParts(runs.map((run) => run.keys[key])));
      out.push(
        ...longFramesOf(
          runs.flatMap((run) => run.keys.stretch.longFrames),
          3,
        ),
      );
    } else if (bar.id === 'alignment') {
      for (const run of runs) {
        const where = (['keys', 'fling', 'pageDown'] as const)
          .map((stretch) => {
            const part = stretch === 'keys' ? run.keys.stretch : run[stretch];
            return `${stretch} ${part.misaligned} frames, worst ${shown(part.worst, 2)} px`;
          })
          .join('; ');
        out.push(`- Run ${run.run}: ${where}.`);
      }
    } else if (bar.id === 'memory' || bar.id === 'heapGrowth') {
      for (const run of runs) {
        const { afterLoad, afterFirst, afterSecond, peak } = run.memory;
        out.push(
          `- Run ${run.run}: the heap after a collection, ${shown(afterLoad.heap, 0)} MB once ` +
            `opened, ${shown(afterFirst.heap, 0)} after the flings, ${shown(afterSecond.heap, 0)} ` +
            `after PageDown; resident ${shown(afterLoad.resident, 0)}, ` +
            `${shown(afterFirst.resident, 0)}, ${shown(afterSecond.resident, 0)} MB, and ` +
            `${shown(peak, 0)} MB at its largest.`,
        );
      }
    }
    out.push('');
  }
  return out;
}

/** Whether a bar's ID names one of the keys a run times. */
function isKeyBar(id: string): id is 'heldJ' | 'nextFile' | 'nextChange' | 'end' {
  return ['heldJ', 'nextFile', 'nextChange', 'end'].includes(id);
}

/** Where the reported keys' time went, at the median. */
function keyParts(times: readonly KeyTimes[]): string[] {
  const parts = times.flatMap((time) => time.parts);
  if (parts.length === 0) return [];
  const part = (name: 'waiting' | 'handling' | 'toPaint'): string =>
    shown(median(parts.map((each) => each[name])), 1);
  return [
    `- Of the ${parts.length} presses the Event Timing API reported, at the median: waiting for ` +
      `the main thread ${part('waiting')} ms, in the handlers ${part('handling')} ms, from then to ` +
      `the paint ${part('toPaint')} ms.`,
  ];
}

/** The longest frames, with the scripts that took the longest in each. */
function longFramesOf(frames: readonly LongFrameEntry[], count: number): string[] {
  return frames
    .toSorted((a, b) => b.duration - a.duration)
    .slice(0, count)
    .map((frame) => {
      const scripts = frame.scripts
        .map(
          (script) =>
            `${script.invoker || 'a script'} (${script.source || 'unknown'}) ` +
            `${shown(script.duration, 0)} ms` +
            (script.forcedLayout > 1
              ? `, ${shown(script.forcedLayout, 0)} ms of it forced layout`
              : ''),
        )
        .join('; ');
      const rendering = frame.start + frame.duration - frame.renderStart;
      return (
        `- A ${shown(frame.duration, 0)} ms frame: ${scripts || 'no script named'}; ` +
        `rendering ${shown(rendering, 0)} ms.`
      );
    });
}
