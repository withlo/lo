/** Why a download or an install failed. */

/**
 * - `refused`: it broke one of Lo's rules: an address or redirect Lo doesn't download from, a
 *   file larger than the manifest says, or an archive with a path, link or file Lo won't unpack.
 * - `mismatch`: what came isn't what the manifest pinned: another size or hash.
 * - `unavailable`: the server answered with something other than the file, such as 404.
 * - `interrupted`: the connection failed, the file came short, or the server had trouble. Only
 *   this is worth trying again by itself.
 * - `space`: the disk hasn't room for it.
 * - `build`: a program Lo builds from what it downloaded, as it does gopls, didn't build.
 */
export type DownloadProblem =
  'refused' | 'mismatch' | 'unavailable' | 'interrupted' | 'space' | 'build';

/** A download Lo couldn't make, or won't use. Its message says why, for the reader. */
export class DownloadError extends Error {
  override name = 'DownloadError';
  readonly problem: DownloadProblem;

  constructor(problem: DownloadProblem, message: string, options?: ErrorOptions) {
    super(message, options);
    this.problem = problem;
  }
}
