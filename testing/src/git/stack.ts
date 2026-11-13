/**
 * The stacks the app's end-to-end tests open, in rozed-dev/e2e, as a git remote on this machine:
 * `testing/fixtures/stack.sh` makes every commit with the ID GitHub has for it, so Lo can fetch
 * them from here while the replay server answers for GitHub's API.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testGitEnvironment } from './git.ts';

/** The script, `testing/fixtures/stack.sh`. */
export const stackScript = fileURLToPath(new URL('../../fixtures/stack.sh', import.meta.url));

/**
 * The pull requests and their heads, as GitHub has them: each layer's number and head commit, the
 * branch none of them comes from, #B's overview, and the GitHub stack of #G1 and #G2.
 */
export const STACK_PULLS = {
  owner: 'rozed-dev',
  repo: 'e2e',
  /** `stack/root`, which #A, #C and #G1 go into. */
  root: '28c4eeff168c2baf91d2b902b85d06e94f8a90c9',
  /** `stack/a` into `stack/root`. */
  a: { number: 82, head: '59b27c734c12089f5a795fe1f30bb1b5cad89650' },
  /** `stack/b` into `stack/a`. Its overview is at `refs/lo/pr/83`. */
  b: {
    number: 83,
    head: '57dbd43bc2ea7a521b1f9218a22cdd96b4c4f5d1',
    overview: '24494ed9f4e2ea84482416e4cfa08d5baf021acb',
  },
  /** `stack/c` into `stack/root`, cut from #B's head with one more commit. */
  c: { number: 84, head: 'f9db1743681826e72f3b31e3d9967d28a55af20d' },
  /** `stack/d` into `stack/a`, opened after #B. */
  d: { number: 85, head: '00003e523dc4a621fc94e0af286f9212ed4e30c0' },
  /** `stack/m` into `stack/mroot`, squash-merged. */
  m: { number: 86, head: 'a5f519461fbac8b315f978b48deb5cf66ca22a22' },
  /** `stack/e` into `stack/m`, cut from #M's head. */
  e: { number: 87, head: 'b0e71e0b3274ad2bba7ddd21c6bcf04810d056f2' },
  /** `stack/g1` into `stack/root`, the bottom of GitHub stack #90. */
  g1: { number: 88, head: '1727dc85d2e6e6f24d49b47b1397b69aa16ef1af' },
  /** `stack/g2` into `stack/g1`, the top of GitHub stack #90. */
  g2: { number: 89, head: '973eab4d84b2a6f6f8660d10ebdcc4c852810627' },
  /** The GitHub stack of #G1 and #G2. */
  githubStack: 90,
} as const;

/**
 * Makes the pull requests' repository in `folder`, as `rozed-dev/e2e.git`, and returns the address
 * to give Lo as `LO_GIT_REMOTE`.
 */
export function writeStackRemote(folder: string): string {
  execFileSync('bash', [stackScript, folder], {
    env: testGitEnvironment(),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return `file://${folder}`;
}
