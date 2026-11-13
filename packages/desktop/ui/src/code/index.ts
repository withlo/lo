// `@lo/ui/code`: the code views. Everything outside this folder reaches them through here, in Lo's
// own terms (`api.ts`).

export type {
  BoxFrame,
  BoxParts,
  Composer,
  ComposerEvents,
  ComposerInit,
  CursorReading,
  DiffEvents,
  DiffFile,
  DiffInit,
  DiffLayout,
  DiffNote,
  DiffView,
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  FileDiff,
  FileEvents,
  FileHeader,
  FileInit,
  FileView,
  Fold,
  HeaderTarget,
  JumpTo,
  KeySource,
  LineTarget,
  LinesMark,
  Mark,
  Misalignment,
  Mode,
  MovedCode,
  MovedEnd,
  Movement,
  OverviewMark,
  PassStats,
  PeekAnswer,
  PeekSource,
  PeekView,
  Place,
  Probe,
  RenderThread,
  Send,
  Side,
  Span,
  Spot,
  Target,
  ThreadContent,
  ThreadView,
  Viewport,
  VimKey,
  WordRange,
} from './api.ts';
export { diffMotions } from './api.ts';
export { createComposer } from './composer.ts';
export { createExcerptView } from './excerpt.ts';
export { createFileView } from './file.ts';
export { createDiffView } from './view.ts';
export { focusedMode, onFocusedMode, type ModeName } from './mode.ts';
export { codeTypeface } from './typeface.ts';
