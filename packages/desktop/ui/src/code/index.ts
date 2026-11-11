// `@lo/ui/code`: the code views. Everything outside this folder reaches them through here, in Lo's
// own terms (`api.ts`).

export type {
  Composer,
  ComposerEvents,
  CursorReading,
  DiffEvents,
  DiffFile,
  DiffInit,
  DiffLayout,
  DiffNote,
  DiffView,
  FileDiff,
  FileHeader,
  Fold,
  JumpTo,
  KeySource,
  Misalignment,
  Mode,
  MovedBlock,
  Movement,
  PassStats,
  Place,
  Probe,
  Send,
  Side,
  Span,
  Target,
  ThreadComment,
  ThreadView,
  VimKey,
} from './api.ts';
export { diffMotions } from './api.ts';
export { createDiffView } from './view.ts';
