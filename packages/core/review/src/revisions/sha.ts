/** GitHub's SHAs as the revisions read them. */

/** The SHA, or nothing for an empty one or GitHub's all-zero "no commit" SHA. */
export function sha(value: string | undefined): string | undefined {
  return value === undefined || /^0*$/.test(value) ? undefined : value;
}
