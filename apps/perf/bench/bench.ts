// The bench: measures the diff view on large pull requests against its bars, on a Mac with the
// display awake, and writes a report with traces and videos beside it. See the README.
//
//   pnpm nx run perf:bench                      everything: three runs, traces, videos
//   pnpm nx run perf:bench -- --runs 1 --pull kubernetes-125488 --width 1440 --limit 50000
//   pnpm nx run perf:bench -- --report bench/results/<folder>   rewrite its report.md
//
// Options, each optional: `--pull <name>` and `--width 1440|screen`, either more than once, to
// measure only those; `--runs <n>`; `--limit <px>` to stop each full scroll early, for a trial;
// `--no-zr`, `--no-traces`, `--no-videos`; `--out <folder>`. `--report` writes `report.md` again
// from a folder's `report.json`, with its `notes.md`, if it has one, under the summary.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { measureRun, measureZR } from './measure.ts';
import type { Recording } from './recorder.ts';
import { sizeOf, traceRun, videoRun } from './media.ts';
import { reportMarkdown, titleOf } from './report.ts';
import type { Conditions, Results, Width } from './results.ts';
import { launch, screenOf } from './suite.ts';

/** The pull requests the bars are for, and the one `zR` is measured on. */
const pullRequests = ['kubernetes-125488', 'typescript-51387'];
const zRPull = { pull: 'typescript-54820', path: 'src/compiler/checker.ts' };
/** The file kept out of TypeScript#51387's documents that the report times loading. */
const large: Record<string, string> = { 'typescript-51387': 'src/compiler/checker.ts' };

const { values } = parseArgs({
  options: {
    pull: { type: 'string', multiple: true },
    width: { type: 'string', multiple: true },
    runs: { type: 'string', default: '3' },
    limit: { type: 'string' },
    'no-zr': { type: 'boolean', default: false },
    'no-traces': { type: 'boolean', default: false },
    'no-videos': { type: 'boolean', default: false },
    out: { type: 'string' },
    report: { type: 'string' },
  },
});

if (values.report) {
  const folder = values.report;
  // The bench wrote it, from these types.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const saved = JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8')) as Results;
  const notes = join(folder, 'notes.md');
  writeFileSync(
    join(folder, 'report.md'),
    reportMarkdown(saved, existsSync(notes) ? readFileSync(notes, 'utf8') : undefined),
  );
  console.log(`The report: ${join(folder, 'report.md')}`);
  process.exit(0);
}

if (process.platform !== 'darwin') {
  console.error('The bench runs on a Mac, with the display awake.');
  process.exit(1);
}
const suiteFolder = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(join(suiteFolder, 'dist/main/index.js'))) {
  console.error('Build the suite first: pnpm nx run perf:build');
  process.exit(1);
}

const pulls = values.pull ?? pullRequests;
const widths = (values.width ?? ['1440', 'screen']).map((width): Width => {
  if (width !== '1440' && width !== 'screen') throw new Error('A width is 1440 or screen.');
  return width;
});
const runs = Number(values.runs);
const limit = values.limit === undefined ? undefined : Number(values.limit);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = values.out ?? join(suiteFolder, 'bench/results', stamp);
mkdirSync(join(out, 'traces'), { recursive: true });
mkdirSync(join(out, 'videos'), { recursive: true });
mkdirSync(join(out, 'frames'), { recursive: true });

const results: Results = {
  conditions: await conditions(),
  runs: [],
  zR: [],
  traces: [],
  videos: [],
};
if (limit !== undefined) {
  console.log(`Each full scroll stops after ${limit} px: a trial, not the bars' measurements.`);
}

const save = (): void => {
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(out, 'report.md'), reportMarkdown(results));
};
const frameCheck = (median: number): void => {
  results.conditions.frameCheck.push(median);
};
const memoryInUse = (): void => {
  results.conditions.memoryInUse.push(inUseGB());
};

for (let run = 1; run <= runs; run++) {
  for (const pull of pulls) {
    for (const width of widths) {
      console.log(`Run ${run}: ${titleOf(pull)} at ${widthLabel(width)}…`);
      memoryInUse();
      const kept: Record<string, Recording> = {};
      const result = await measureRun(pull, width, run, {
        ...(limit === undefined ? {} : { limit }),
        ...(large[pull] ? { large: large[pull] } : {}),
        frameCheck,
        keep: (stretch, recording) => {
          kept[stretch] = recording;
        },
        progress: (line) => console.log(`  ${line}`),
      });
      // Every frame, for looking closer at a stretch than the report does.
      writeFileSync(
        join(out, 'frames', `${pull}-${width}-${run}.json.gz`),
        gzipSync(JSON.stringify(kept)),
      );
      memoryInUse();
      results.runs.push(result);
      console.log(
        `  open ${result.open.firstDrawn?.toFixed(0)} ms, loaded ${result.open.loaded?.toFixed(0)} ms; ` +
          `flings p95 ${result.fling.frames.p95?.toFixed(1)} ms, max ${result.fling.frames.max?.toFixed(0)} ms, ` +
          `${result.fling.blank.frames} blank; PageDown p95 ${result.pageDown.frames.p95?.toFixed(1)} ms, ` +
          `${result.pageDown.blank.frames} blank, stopped short ${result.stuck.length} times; worst misalignment ${result.alignment.worst.toFixed(2)} px; ` +
          `memory ${result.memory.peak.toFixed(0)} MB, heap growth ${result.memory.growth.toFixed(1)}%`,
      );
      save();
    }
  }
  if (!values['no-zr']) {
    for (const width of widths) {
      console.log(`Run ${run}: zR on ${zRPull.path} at ${widthLabel(width)}…`);
      memoryInUse();
      const result = await measureZR(zRPull.pull, zRPull.path, width, run, frameCheck);
      results.zR.push(result);
      console.log(`  ${JSON.stringify(result.keyToPaint)}`);
      save();
    }
  }
}

if (!values['no-traces']) {
  for (const pull of pulls) {
    for (const width of widths) {
      console.log(`Tracing ${titleOf(pull)} at ${widthLabel(width)}…`);
      results.traces.push(...(await traceRun(pull, width, join(out, 'traces'))));
      save();
    }
  }
  if (!values['no-zr']) {
    console.log(`Tracing zR on ${zRPull.path}…`);
    results.traces.push(...(await traceRun(zRPull.pull, '1440', join(out, 'traces'), zRPull.path)));
  }
}

if (!values['no-videos']) {
  // Playwright records with its own build of ffmpeg, which it downloads once.
  const cli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
  execFileSync(process.execPath, [cli, 'install', 'ffmpeg'], { stdio: 'inherit' });
  const videos = [
    ...pulls.map((pull) => ({ pull, zR: undefined })),
    ...(values['no-zr'] ? [] : [{ pull: zRPull.pull, zR: zRPull.path }]),
  ];
  for (const { pull, zR } of videos) {
    console.log(`Recording ${titleOf(pull)}${zR ? `, zR on ${zR}` : ''}…`);
    const video = await videoRun(pull, join(out, 'videos'), zR);
    results.videos.push(video.mp4);
    console.log(`  ${sizeOf(video.mp4)}, ${video.seconds.toFixed(0)} s`);
    if (video.seconds >= 90) console.log('  It runs 90 seconds or more.');
    save();
  }
}

results.conditions.finished = new Date().toISOString();
memoryInUse();
save();
console.log(`The report: ${join(out, 'report.md')}`);

/** The machine, its display, and the suite's Electron, read from a launch. */
async function conditions(): Promise<Conditions> {
  const suite = await launch('typescript-54820', '1440');
  try {
    const screen = await screenOf(suite.app);
    if (screen.locked)
      throw new Error('The screen is locked. The bench needs it unlocked and awake.');
    const versions = await suite.app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      gpu: Object.fromEntries(Object.entries(app.getGPUFeatureStatus())),
    }));
    return {
      machine: sysctl('hw.model'),
      chip: sysctl('machdep.cpu.brand_string') || `${cpus().length} cores`,
      memoryGB: Math.round(totalmem() / 2 ** 30),
      macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
      electron: versions.electron,
      chromium: versions.chromium,
      display: {
        label: screen.label,
        width: screen.width,
        height: screen.height,
        workArea: screen.workArea,
        scale: screen.scale,
        hz: screen.hz,
      },
      gpu: versions.gpu,
      memoryInUse: [inUseGB()],
      frameCheck: [],
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: suiteFolder,
        encoding: 'utf8',
      }).trim(),
      started: new Date().toISOString(),
    };
  } finally {
    await suite.app.close();
  }
}

function widthLabel(width: Width): string {
  return width === '1440' ? '1440 px' : 'the screen’s width';
}

function sysctl(name: string): string {
  return execFileSync('sysctl', ['-n', name], { encoding: 'utf8' }).trim();
}

/** The machine's memory in use, in GB, as Activity Monitor counts it: app memory, wired, compressed. */
function inUseGB(): number {
  const stats = execFileSync('vm_stat', { encoding: 'utf8' });
  const pageSize = Number(/page size of (\d+) bytes/.exec(stats)?.[1] ?? 16_384);
  const pages = (label: string): number =>
    Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stats)?.[1] ?? 0);
  const used =
    pages('Anonymous pages') -
    pages('Pages purgeable') +
    pages('Pages wired down') +
    pages('Pages occupied by compressor');
  return (used * pageSize) / 2 ** 30;
}
