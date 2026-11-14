// The comments' jobs in the background process: a post's text as Lo's tree, from GitHub's rendering
// of it once main has read that, and from its Markdown until then, so text is never blank; and a
// file attached to a comment, checked and with its metadata taken out, as it's uploaded. Nothing
// here calls Node or Electron.

import type { Metadata } from '@lo/github';
import { DEFAULT_LIMITS, type Tree } from '@lo/markdown';
import { z } from 'zod';

import { reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';
import { ATTACHMENT_LIMIT, fileName } from './contract.ts';

/**
 * The most characters of GitHub's rendering a post's tree is made from: as many as `@lo/markdown`
 * reads bytes of it. A longer rendering is more bytes than that, and the post shows from its
 * Markdown, as it would past the limit.
 */
export const HTML_LIMIT = DEFAULT_LIMITS.html;

/**
 * The most characters of a post's Markdown sent: four times GitHub's limit for a body, which counts
 * characters as code points, and more than `@lo/markdown` reads of it.
 */
export const MARKDOWN_LIMIT = 4 * DEFAULT_LIMITS.length;

/** A repository as GitHub allows its owner and name. */
const repo = z.strictObject({
  owner: z.string().min(1).max(39),
  name: z.string().min(1).max(100),
});

/** What `comments.render` takes. */
export const renderInput = z.strictObject({
  /** GitHub's rendering of the post, once main has read it; until then, null. */
  html: z.string().max(HTML_LIMIT).nullable(),
  /** The post's Markdown, which shows until its rendering is there, or when that can't be read. */
  markdown: z.string().max(MARKDOWN_LIMIT),
  /** The repository the post is in, which `#123` and the like refer to. */
  repo,
  /** The address of the page the post is on, which relative links resolve against. */
  page: z.string().max(8192),
});
export type RenderInput = z.output<typeof renderInput>;

/** A post's tree, and whether it holds an image, whose address GitHub signs for a few minutes. */
export interface Rendered {
  tree: Tree;
  images: boolean;
}

/**
 * What `comments.prepare` takes: a file's name, and its bytes, or nothing for one larger than
 * {@link ATTACHMENT_LIMIT}, which no kind may be, so it isn't read.
 */
export const prepareInput = z.strictObject({
  name: fileName,
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= ATTACHMENT_LIMIT)
    .nullable(),
});
export type PrepareInput = z.output<typeof prepareInput>;

/**
 * A file ready to upload: its name, the bytes to send, how large they are as people read sizes,
 * what Lo took out of it, and whether GitHub takes it only on a paid plan; or why Lo won't attach
 * it, in a few words.
 */
export type Prepared =
  | {
      kind: 'prepared';
      name: string;
      bytes: Uint8Array<ArrayBuffer>;
      size: string;
      metadata: Metadata;
      paidPlan: boolean;
    }
  | { kind: 'refused'; why: string };

export const contract = defineJobs('comments', {
  /** A post's text as Lo's tree: from its HTML when given, else from its Markdown. */
  render: { input: renderInput, reply: reply<Rendered>() },
  /**
   * A file to attach, checked as GitHub takes it, by its name, its bytes and their size, with its
   * metadata taken out.
   */
  prepare: { input: prepareInput, reply: reply<Prepared>() },
});
