/**
 * The files a pull request changes: what kind each one is, which are generated, the order they're
 * listed in, how each one starts out and how it shows (`docs/design.md`, "Modes" and "The diff
 * view").
 */

export { changedLines, comparePaths, type ChangedFile } from './files/changed.ts';
export {
  binaryText,
  collapsedDetail,
  collapsedLabel,
  initialCollapse,
  isLarge,
  MAX_LINE_BYTES,
  MAX_SHOWN_BYTES,
  sizeText,
  tooLargeToShow,
  type Collapsed,
} from './files/display.ts';
export { isLockfile, whyGenerated, type Generated } from './files/generated.ts';
export {
  imageSummary,
  readImage,
  type Dimensions,
  type ImageFormat,
  type Images,
  type ImageSide,
} from './files/images.ts';
export { fileKind, type FileKind } from './files/kind.ts';
export {
  changeLetter,
  FileList,
  githubChange,
  githubFileEntry,
  type FileChange,
  type FileEntry,
  type FileOrder,
} from './files/list.ts';
export { pathOrder, reviewOrder, reviewRows, type ReviewRow } from './files/order.ts';
export {
  initialState,
  LARGE_FILE_BYTES,
  LARGE_FILE_LINES,
  startsCollapsed,
  type InitialState,
} from './files/state.ts';
export { withoutWhitespaceChanges } from './files/whitespace.ts';
