// What one run of the bench measures, as `report.json` keeps it.

import type { LongFrame } from '../src/window/marks.ts';
import type { LongFrameEntry } from './recorder.ts';
import type { FrameSummary, KeyTimes } from './stats.ts';

/** The two widths: 1440 px, and the screen's full width. */
export type Width = '1440' | 'screen';

/** Frames with something blank on screen, and what was blank in them. */
export interface Blank {
  /** Frames with any of these. */
  frames: number;
  /** Frames with a row drawn on one side only. */
  oneSided: number;
  /** Frames where part of the screen inside an editor's content wasn't drawn. */
  undrawn: number;
  /** Frames the scroll ran further than the last frame drew beyond the screen. */
  past: number;
  /** The most px left blank in one frame, either way. */
  worstPx: number;
}

/** A stretch of frames: a scroll from top to bottom, or the keys. */
export interface Stretch {
  /** Frame times in whole refreshes, as the bars read them, and as `requestAnimationFrame` gave them. */
  frames: FrameSummary;
  raw: FrameSummary;
  blank: Blank;
  /** The worst misalignment in any frame, in px, and how many frames were over 0.5 px. */
  worst: number;
  misaligned: number;
  /** How far it scrolled, in px, and how long it took, in ms. */
  scrolled: number;
  ms: number;
  /** Wheel events or key presses sent. */
  inputs: number;
  /** The readings' own cost per frame, at the 95th percentile, in ms. */
  readMs: number | undefined;
  /** The frames over 50 ms, the longest first. */
  longFrames: LongFrameEntry[];
}

export interface Memory {
  /** The renderer's resident memory, in MB, after each full scroll, at its largest, and the JS heap after a collection, in MB. */
  afterLoad: { resident: number; heap: number };
  afterFirst: { resident: number; heap: number };
  afterSecond: { resident: number; heap: number };
  /** The renderer's resident memory at its largest, in MB. */
  peak: number;
  /** How much the heap grew over the second full scroll, in %. */
  growth: number;
}

export interface RunResult {
  pull: string;
  width: Width;
  run: number;
  /** The window's inner size, as the page reads it. */
  inner: { width: number; height: number };
  /** The document's height, in px, once fully scrolled. */
  height: number;
  open: {
    /** From main starting to open the pull request to the first file drawn, in ms. */
    firstDrawn: number | undefined;
    /** From main starting to open it to the last diff and the moves arriving, in ms. */
    loaded: number | undefined;
    /** The longest task on the page's main thread until then, in ms. */
    longestTask: number;
    /** Where the time went, each step from the one before, in ms. */
    steps: Record<string, number | undefined>;
    longTasks: { start: number; duration: number }[];
    longFrames: LongFrame[];
  };
  fling: Stretch;
  pageDown: Stretch;
  keys: {
    heldJ: KeyTimes;
    nextFile: KeyTimes;
    nextChange: KeyTimes;
    end: KeyTimes;
    otherSide: KeyTimes;
    /** Held PageDown, from the second full scroll. */
    pageDown: KeyTimes;
    /** Typing in a comment box, and a held key that changes nothing: what any key costs here. */
    typing: KeyTimes;
    nothing: KeyTimes;
    stretch: Stretch;
  };
  alignment: { worst: number; misaligned: number; frames: number };
  memory: Memory;
  /** Loading a file kept out of the documents, when the pull request has the one asked for. */
  large?: { path: string; lines: number | undefined; diff: number | undefined };
  /** Readings that went wrong, as the report should say. */
  notes: string[];
}

/** `zR` on a file, in one run. */
export interface ZRResult {
  pull: string;
  path: string;
  width: Width;
  run: number;
  keyToPaint: KeyTimes;
  /** The file's unchanged lines all open, the frames until then, and how level the rows stayed. */
  stretch: Stretch;
  notes: string[];
}

/** The machine and what was running while the bench ran. */
export interface Conditions {
  machine: string;
  chip: string;
  memoryGB: number;
  macOS: string;
  electron: string;
  chromium: string;
  display: {
    label: string;
    width: number;
    height: number;
    workArea: { width: number; height: number };
    scale: number;
    hz: number;
  };
  gpu: Record<string, string>;
  /** The machine's memory in use, in GB, as each run started and ended. */
  memoryInUse: number[];
  /** The frames' median time when the display was checked, in ms. */
  frameCheck: number[];
  commit: string;
  started: string;
  finished?: string;
}

export interface Results {
  conditions: Conditions;
  runs: RunResult[];
  zR: ZRResult[];
  traces: string[];
  videos: string[];
}
