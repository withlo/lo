export * from './tree.ts';
export {
  DEFAULT_LIMITS,
  MAX_ADDRESS,
  MAX_DIAGNOSTICS,
  resolveLimits,
  type Limits,
} from './limits.ts';
export { isWebLink, webLink } from './links.ts';
export { imageAddress, imageSources, isImageAddress, type ImageSource } from './images.ts';
export {
  markdownTree,
  type BlockHandler,
  type HandlerContext,
  type InlineHandler,
  type MarkdownOptions,
  type Syntax,
} from './markdown.ts';
export { githubTree, type GithubOptions, type Post } from './github.ts';
export type { Plugin } from './parser.ts';
export type { Repo } from './references.ts';
export { plainText } from './text.ts';
export {
  FIGURE_COLORS,
  isSvgAttribute,
  MAX_MAGNITUDE,
  MAX_NAME,
  SVG_ELEMENTS,
  type SvgName,
  type SvgRule,
  type SvgValue,
} from './allowlist.ts';
export {
  MAX_SVG_NAME,
  sanitizeSvg,
  SVG_LIMITS,
  type SanitizedSvg,
  type SvgElement,
  type SvgLimits,
  type SvgNode,
  type SvgReason,
  type SvgRemoval,
  type SvgText,
} from './svg.ts';
