// The report: `report.json` keeps everything measured; `report.md` shows a table per pull request,
// a row per bar at each width, with the median of the runs, the worst run and whether every run
// met the bar, then the conditions, what each timer starts and stops on, and where the time went
// in the bars that failed.

import {
  aboveFloor,
  type Bar,
  bars,
  checkLength,
  checkSpeeds,
  judge,
  type Judged,
  keyReading,
  type Reading,
  scrollSpeed,
  zRBar,
} from './bars.ts';
import type { LongFrameEntry } from './recorder.ts';
import type { Results, RunResult, Stretch, Width } from './results.ts';
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
      // Under 10 px is alignment, which counts in hundredths; more is a blank's height.
      return `${shown(reading, reading >= 10 ? 0 : 2)} px`;
    case 'MB':
      return `${shown(reading, 0)} MB`;
    case '%':
      return `${shown(reading, 1)}%`;
    case 'count':
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
      '| Metric | Width | Bar | Median | Worst run | Result | Beside it (median / worst run) |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const bar of bars) {
      for (const width of widths) {
        const runs = results.runs.filter((run) => run.pull === pull && run.width === width);
        const result = judged(results, pull, width).find((row) => row.bar.id === bar.id)!.judged;
        lines.push(
          `| ${bar.label} | ${widthName(width, results)} | ${bar.shown(pull)} | ${showReading(result.median, bar.unit)} | ${showReading(result.worst, bar.unit)} | ${verdict(result)} | ${detailCell(bar, runs)} |`,
        );
      }
    }
    lines.push(
      '',
      'The last column isn’t judged. For a key, it’s the time above the floor: the same ' +
        'statistic (p95, or the slowest press) of a key in the same run whose only effect is to ' +
        'recolour a 4 px square. For blank rows, it’s the widest blank in any frame.',
      '',
      ...openingLines(
        results.runs.filter((run) => run.pull === pull),
        results,
      ),
      '',
    );
    const extra = results.runs.filter((run) => run.pull === pull);
    lines.push(...keysTable(extra, results), '', ...detailsOf(extra, results), '');
  }

  if (results.zR.length > 0) {
    lines.push('## `zR` on `src/compiler/checker.ts`, microsoft/TypeScript#54820', '');
    lines.push(
      '| Width | Bar | Median | Worst run | Result | Above the floor (median / worst run) |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const width of widthsOf(results)) {
      const runs = results.zR.filter((run) => run.width === width);
      if (runs.length === 0) continue;
      const result = judge(
        runs.map((run) => keyReading(run.keyToPaint, 100)),
        zRBar.limit,
      );
      const above = judge(
        runs.map((run) => aboveFloor(run.keyToPaint, run.floor, 100)),
        zRBar.limit,
      );
      lines.push(
        `| ${widthName(width, results)} | ${zRBar.shown} | ${showReading(result.median, 'ms')} | ${showReading(result.worst, 'ms')} | ${verdict(result)} | ${showReading(above.median, 'ms')} / ${showReading(above.worst, 'ms')} |`,
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

/** A bar's second reading, at the median and the worst of the runs, with what it is. */
function detailCell(bar: Bar, runs: RunResult[]): string {
  if (!bar.detail) return '';
  const { read, unit, label } = bar.detail;
  const result = judge(
    runs.map((run) => read(run)),
    Infinity,
  );
  if (result.median === undefined) return '';
  return `${showReading(result.median, unit)} / ${showReading(result.worst, unit)} ${label}`;
}

/** What comes before the page opens the pull request, which the opening's timer leaves out. */
function openingLines(runs: RunResult[], results: Results): string[] {
  const out: string[] = [];
  for (const width of widthsOf(results)) {
    const atWidth = runs.filter((run) => run.width === width);
    if (atWidth.length === 0) continue;
    const show = (pick: (run: RunResult) => number | undefined): string =>
      showReading(median(atWidth.map(pick).filter((value) => value !== undefined)), 'ms');
    out.push(
      `- Before the page opens it, at ${widthName(width, results)}, at the median: main reads ` +
        `every file in ${show((run) => run.open.read)}, and the window starts and loads the ` +
        `page in ${show((run) => run.open.window)}. The suite does both before the page starts ` +
        'opening the pull request; the app reads files as it needs them, and starts its window ' +
        'once. The background process starts diffing as soon as main has read the files, ' +
        `${show((run) => run.open.headStart)} before the page starts opening the pull request, ` +
        'so the open figure can read up to that much low: the first file’s diff may be under way ' +
        'when its timer starts.',
    );
  }
  return out;
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
  { key: 'floor', label: 'Held F7, which only recolours a 4 px square: the floor' },
  { key: 'nothing', label: 'Held `Esc`, which changes nothing and so paints nothing' },
];

function keysTable(runs: RunResult[], results: Results): string[] {
  const out = [
    'Every key, from its keydown to the next paint (Event Timing), all runs together. The last ' +
      'two have no bar: the floor is what any key that paints costs in this window on this ' +
      'display; a key that paints nothing ends at the next frame instead, so it’s no floor.',
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
        longFrames: [],
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
/** A stretch's frames with blank rows, and what was blank in them. */
function blankOf(stretch: Stretch): string {
  const share =
    stretch.frames.frames === 0 ? 0 : (stretch.blank.frames / stretch.frames.frames) * 100;
  return (
    `${stretch.blank.frames} (${shown(share, 0)}%) with blank rows (${stretch.blank.oneSided} with a row on one side, ` +
    `${stretch.blank.undrawn} undrawn, ${stretch.blank.past} scrolled past what was drawn; at ` +
    `worst ${shown(stretch.blank.worstPx, 0)} px)`
  );
}

/** The least and the most of `values`. */
function range(values: number[], digits: number): string {
  return `${shown(Math.min(...values), digits)} to ${shown(Math.max(...values), digits)}`;
}

function detailsOf(runs: RunResult[], results: Results): string[] {
  const out: string[] = [];
  for (const run of runs) {
    const width = widthName(run.width, results);
    const { memory } = run;
    out.push(
      `- Run ${run.run} at ${width}: window ${run.inner.width} × ${run.inner.height} px, ` +
        `document ${shown(run.height / 1000, 0)}k px tall.`,
      `  - Scrolling at ${shown(run.scroll.speed, 0)} px/s: ${shown(run.scroll.scrolled / 1000, 0)}k px in ` +
        `${shown(run.scroll.ms / 1000, 1)} s, ${run.scroll.frames.frames} frames, ${blankOf(run.scroll)}. ` +
        run.speeds
          .map(
            (check) =>
              `At ${shown(check.speed, 0)} px/s over ${shown(check.stretch.scrolled / 1000, 0)}k px: ` +
              `${check.stretch.frames.frames} frames, ${blankOf(check.stretch)}.`,
          )
          .join(' ') +
        ` Flings over ${shown(run.fling.scrolled / 1000, 0)}k px: ${run.fling.inputs} flings in ` +
        `${shown(run.fling.ms / 1000, 1)} s, ${run.fling.frames.frames} frames (p95 ` +
        `${shown(run.fling.frames.p95)} ms, longest ${shown(run.fling.frames.max)} ms), ${blankOf(run.fling)}.` +
        ` The readings cost ${shown(run.scroll.readMs, 2)} ms a frame (p95).`,
      `  - PageDown: ${run.pageDown.inputs} presses, ${shown(run.pageDown.ms / 1000, 1)} s, ` +
        `${shown(run.reached * 100, 0)}% of the way down, stopped short ${run.stuck.length} times; ` +
        `${run.pageDown.frames.frames} frames, ${blankOf(run.pageDown)}.`,
      `  - Memory, after a collection, once opened, after the first full scroll and after the ` +
        `second: footprint ${shown(memory.afterLoad.footprint, 0)}, ${shown(memory.afterFirst.footprint, 0)}, ` +
        `${shown(memory.afterSecond.footprint, 0)} MB; resident (which counts shared pages and ` +
        `pages freed but not taken back) ${shown(memory.afterLoad.resident, 0)}, ` +
        `${shown(memory.afterFirst.resident, 0)}, ${shown(memory.afterSecond.resident, 0)} MB; JS ` +
        `heap ${shown(memory.afterLoad.heap, 0)}, ${shown(memory.afterFirst.heap, 0)}, ` +
        `${shown(memory.afterSecond.heap, 0)} MB. At their largest: footprint ` +
        `${shown(memory.peak.footprint, 0)} MB, resident ${shown(memory.peak.resident, 0)} MB.` +
        (memory.gpu
          ? ` The GPU process, which draws the window: footprint ${shown(memory.gpu.footprint, 0)} MB, ` +
            `${shown(memory.gpu.peak, 0)} MB at its largest.`
          : ''),
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
    `- Display: ${c.display.label.replaceAll(/[()]/g, '').trim() || 'the main display'}, ${c.display.kind}, refreshing at ` +
      `${shown(c.display.hz, 0)} Hz, so a frame is ${shown(1000 / c.display.hz, 1)} ms; ` +
      `${c.display.width} × ${c.display.height} px at ${c.display.scale}× ` +
      `(${c.display.workArea.width} × ${c.display.workArea.height} px for windows).`,
    `- Electron ${c.electron}, Chromium ${c.chromium}. GPU compositing ${c.gpu.gpu_compositing ?? 'unknown'}, ` +
      `rasterization ${c.gpu.rasterization ?? 'unknown'}.`,
    `- While it ran: ${range(inUse, 1)} GB of memory in use on the machine, and a load ` +
      `average over a minute of ${range(c.load, 1)} on ${c.cores} cores.`,
    `- Frames came every ${range(c.frameCheck, 1)} ms, at the median, with the page idle before each run.`,
    `- The production bundle, run unpackaged with \`--js-flags=--expose-gc\`, from ${c.started} to ${c.finished ?? '–'}.`,
  ];
}

function timersOf(): string[] {
  return [
    '## What each timer starts and stops on',
    '',
    '- **Open to first file painted:** starts when the page, its code loaded, starts opening the ' +
      'pull request, as a tab opens one: it asks main for it. It stops when the frame after the one ' +
      'that drew the first file with its diff and highlighting starts running, once that frame has ' +
      'gone to the compositor. Main reading every file and the window starting come before, and ' +
      'are shown on their own under each table; each step is under `open.steps` in `report.json`.',
    '- **All diffs and moves computed:** from main handing the files to the background process to ' +
      'the window receiving the moves, which come after the last diff.',
    '- **Longest main-thread task while opening:** the Long Tasks API’s, on the window’s main ' +
      'thread, from the page starting to open the pull request until the moves arrive.',
    '- **Frames:** the time between one frame’s `requestAnimationFrame` and the next, for every ' +
      'frame from the first input to half a second after the last: the main thread’s frames, which ' +
      'draw the editors. They’re counted in whole refreshes of the display, each rounded to the ' +
      'nearest, since the display’s refreshes come a millisecond or two early or late: a frame that ' +
      'made its refresh is 16.7 ms, one that missed it 33.3 ms. So the bars’ 33 ms is two ' +
      'refreshes, and their 100 ms six. The times as `requestAnimationFrame` gave them are in ' +
      '`report.json` (`raw`). Long Animation Frames entries say what ran in each frame over 50 ms.',
    `- **Scrolling:** Chromium’s own synthesized scroll gesture (\`Input.synthesizeScrollGesture\`, ` +
      'from a mouse), with the pointer over the right side: one gesture of wheel events paced by the ' +
      `display, as a trackpad’s are, at a steady ${scrollSpeed.toLocaleString('en-US')} px a second, ` +
      'in gestures of 20,000 px until the scroll stops at the bottom, with no fling at the end. Blank ' +
      `rows are compared at ${checkSpeeds.map((speed) => speed.toLocaleString('en-US')).join(', ')} px a ` +
      `second, each over the same ${checkLength.toLocaleString('en-US')} px from the top, as a share ` +
      'of the frames, with the widest blank beside it.',
    `- **Flings:** a quick swipe of 3,000 px at 12,000 px a second through the same synthesizer, ` +
      'as touch, which Chromium carries on, slowing down, as its own fling, as a trackpad’s ' +
      'momentum does; then another once it has come to rest, over ' +
      `${checkLength.toLocaleString('en-US')} px from the top.`,
    '- **PageDown:** held, with focus in the right side: a keydown every 33 ms, macOS’s fastest key ' +
      'repeat, sent on the clock without waiting for the page, until the bottom. Where PageDown ' +
      'stops moving short of the bottom, the bench lets go, notes the place, scrolls a screen past ' +
      'it with the wheel and holds PageDown again; the table counts those places. Where PageDown ' +
      'keeps going back to one, after the wheel has taken it up to eight screens past, the bench ' +
      'gives up, and says how far down it got. PageDown’s frames are read only once it reaches the ' +
      'bottom by itself; until then they’re “not measured”.',
    '- **Blank rows:** a frame counts when, after its layout and before its paint, a row is drawn on ' +
      'one side only, or any part of the screen inside either editor’s content isn’t drawn ' +
      '(CodeMirror’s gaps, or lines the view forgot). While scrolling, it also counts when the ' +
      'scroll ran further, between one frame and the next, than the first had drawn beyond the ' +
      'screen: the compositor scrolls on its own and shows that much blank until the page draws ' +
      'again. Keys scroll from script, in the frame that draws what they scroll to.',
    '- **Keys:** the Event Timing API’s duration for the keydown that finishes the command (the `f` ' +
      'of `]f`): from the key event’s time to when the next frame after its handlers ran is ' +
      'presented on the display, rounded to 8 ms. The API reports keys that took 16 ms or more; one ' +
      'it didn’t report took less, shown as “< 16 ms”. `]f` and `]c` are pressed ten times from the ' +
      'top, `G` three times from the top, and `j` held for 150 repeats every 33 ms; the table shows ' +
      'the slowest press, and for `j` the 95th percentile. Every run also holds F7, whose only ' +
      'effect is to recolour a 4 px square: that floor, at the median, is what any key that paints ' +
      'costs on this display, and the last column shows each key less it.',
    '- **Alignment:** after every frame’s layout, before its paint, the on-screen top of every ' +
      'row with something on both sides, its first line or the header, collapsed block or note it ' +
      'starts with, on each side, from the view’s probe; the worst difference of any frame, over ' +
      'the keys (comments typed on each side included), the scrolls and PageDown.',
    '- **Renderer memory:** the window’s renderer process’s footprint, `phys_footprint` from ' +
      'macOS’s `footprint`, what Activity Monitor shows: at its largest over the run, before any ' +
      'large file is loaded. Its resident memory from `app.getAppMetrics()` is shown beside it; it ' +
      'also counts shared pages and pages freed but not yet taken back. The GPU process, which ' +
      'draws the window, is shown on its own. MB are 1,000,000 bytes.',
    '- **Heap growth:** V8’s used heap after two `gc()` calls, after the first full scroll and ' +
      'again after the second, the same scroll from the top.',
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
    } else if (bar.id === 'pageDownStuck') {
      for (const run of runs) {
        const places = run.stuck
          .slice(0, 8)
          .map((place) => `\`${place.at}\` (${shown(place.scrollTop / 1000, 0)}k px down)`);
        const more = run.stuck.length > 8 ? `, and ${run.stuck.length - 8} more` : '';
        out.push(
          `- Run ${run.run}: PageDown got ${shown(run.reached * 100, 0)}% of the way down. It ` +
            `stopped moving ${run.stuck.length} times, short of the ` +
            `bottom; the bench scrolled a screen past each with the wheel and held it again. At ${places.join(', ')}${more}.`,
        );
      }
    } else if (bar.id.endsWith('Blank') || /^blank\d+$/.test(bar.id)) {
      for (const run of runs) {
        const stretch = stretchFor(bar.id, run);
        if (!stretch) continue;
        const { blank, frames } = stretch;
        out.push(
          `- Run ${run.run}: ${blank.frames} of ${frames.frames} frames. A row drawn on one side ` +
            `only: ${blank.oneSided}. Part of the screen inside an editor not drawn: ` +
            `${blank.undrawn}. The scroll ran further than the frame before had drawn beyond the ` +
            `screen: ${blank.past}. At worst ${shown(blank.worstPx, 0)} px blank.`,
        );
      }
    } else if (bar.id.startsWith('scroll') || bar.id.startsWith('pageDown')) {
      for (const run of runs) {
        const stretch = stretchFor(bar.id, run);
        if (!stretch) continue;
        const { frames, raw } = stretch;
        out.push(
          `- Run ${run.run}: ${frames.over16} of ${frames.frames} frames missed a refresh, ` +
            `${frames.over33} missed two or more. As \`requestAnimationFrame\` timed them: p95 ` +
            `${shown(raw.p95)} ms, p99 ${shown(raw.p99)} ms, longest ${shown(raw.max)} ms.`,
        );
      }
      out.push(
        ...longFramesOf(
          runs.flatMap((run) => stretchFor(bar.id, run)?.longFrames ?? []),
          5,
        ),
      );
    } else if (isKeyBar(bar.id)) {
      const key = bar.id;
      out.push(...keyParts(runs.map((run) => run.keys[key])));
      // The frames over 50 ms while this key was pressed and painted, not the whole stretch's.
      out.push(
        ...longFramesOf(
          runs.flatMap((run) => run.keys[key].longFrames),
          3,
        ),
      );
    } else if (bar.id === 'alignment') {
      for (const run of runs) {
        const parts: [string, Stretch][] = [
          ['keys', run.keys.stretch],
          ['scrolling', run.scroll],
          ...run.speeds.map((check): [string, Stretch] => [
            `scrolling at ${shown(check.speed, 0)} px/s`,
            check.stretch,
          ]),
          ['flings', run.fling],
          ['PageDown', run.pageDown],
        ];
        const where = parts
          .map(
            ([name, part]) => `${name} ${part.misaligned} frames, worst ${shown(part.worst, 2)} px`,
          )
          .join('; ');
        out.push(`- Run ${run.run}: ${where}.`);
      }
    } else if (bar.id === 'memory' || bar.id === 'heapGrowth') {
      for (const run of runs) {
        const { afterLoad, afterFirst, afterSecond, peak, gpu } = run.memory;
        out.push(
          `- Run ${run.run}: after a collection, once opened, after the first full scroll and ` +
            `after the second: JS heap ${shown(afterLoad.heap, 0)}, ${shown(afterFirst.heap, 0)}, ` +
            `${shown(afterSecond.heap, 0)} MB; footprint ${shown(afterLoad.footprint, 0)}, ` +
            `${shown(afterFirst.footprint, 0)}, ${shown(afterSecond.footprint, 0)} MB; resident ` +
            `${shown(afterLoad.resident, 0)}, ${shown(afterFirst.resident, 0)}, ` +
            `${shown(afterSecond.resident, 0)} MB. At their largest: footprint ` +
            `${shown(peak.footprint, 0)} MB, resident ${shown(peak.resident, 0)} MB` +
            (gpu ? `; the GPU process ${shown(gpu.peak, 0)} MB.` : '.'),
        );
      }
    }
    out.push('');
  }
  return out;
}

/** The stretch a frame or blank-row bar reads, by the bar's ID. */
function stretchFor(id: string, run: RunResult): Stretch | undefined {
  if (id.startsWith('pageDown')) return run.pageDown;
  if (id.startsWith('fling')) return run.fling;
  const speed = /^blank(\d+)$/.exec(id)?.[1];
  if (speed) return run.speeds.find((check) => check.speed === Number(speed))?.stretch;
  return run.scroll;
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
