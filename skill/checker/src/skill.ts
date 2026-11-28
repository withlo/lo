/**
 * The overview skill, as `install` writes it: its files' text, built into the checker so that what
 * it installs is exactly what it was built with. Its `SKILL.md` runs the checker by its exact
 * version, this package's, so the skill always runs the checker it came with.
 *
 * It's written in two copies, the same but for their front matter:
 *
 * - **`lo-overview`,** a repository's, which `install --repo` writes. The agent starts it by itself
 *   after opening or pushing to a pull request, in the background, and its hook (`hook.mjs`) asks it
 *   to.
 * - **`lo-explain`,** a person's own, which `install` writes. It runs only when asked. Its name is
 *   its own, since Claude Code runs a person's skill in place of a repository's of the same name,
 *   and Codex picks neither when both have one.
 */

import license from '@lo/skill/LICENSE?raw';
import skill from '@lo/skill/SKILL.md?raw';
import explain from '@lo/skill/explain.md?raw';
// Vite's `?raw` gives the file's text, as the default export a script has none of.
// oxlint-disable-next-line import/default, import/no-named-as-default
import hook from '@lo/skill/hook.mjs?raw';
import figures from '@lo/skill/references/figures.md?raw';
import format from '@lo/skill/references/format.md?raw';

import { name, version } from '../package.json' with { type: 'json' };

/** The checker as the skill's source names it, `{version}` standing for its version. */
export const UNPINNED = `${name}@{version}`;

/** The checker as the skill runs it, by its exact version. */
export const PINNED = `${name}@${version}`;

/** One of the skill's files: its path in the skill's folder, and its text. */
export interface SkillFile {
  path: string;
  text: string;
}

/**
 * A copy of the skill: the name its front matter gives, which its folder in a skills folder is
 * named for, and its files, in the order they're written: `SKILL.md` last, so that an agent never
 * finds the skill without the files it names.
 */
export interface Skill {
  name: string;
  files: readonly SkillFile[];
}

/**
 * `text`, a `SKILL.md`, split after its front matter, the closing `---` line's ending included:
 * `matter` is empty when it has none.
 */
export function splitMatter(text: string): { matter: string; body: string } {
  const close = /^---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m.exec(text);
  if (close?.index !== 0) return { matter: '', body: text };
  return { matter: close[0], body: text.slice(close[0].length) };
}

/** `text` with the checker it names pinned to this package's version. */
function pinned(text: string): string {
  return text.replaceAll(UNPINNED, PINNED);
}

/** The files both copies carry besides their `SKILL.md`. */
const REFERENCES: readonly SkillFile[] = [
  { path: 'LICENSE', text: license },
  { path: 'references/format.md', text: format },
  { path: 'references/figures.md', text: figures },
];

/** A repository's copy, with its hook. */
export const REPO_SKILL: Skill = {
  name: 'lo-overview',
  files: [
    ...REFERENCES,
    { path: 'hook.mjs', text: hook },
    { path: 'SKILL.md', text: pinned(skill) },
  ],
};

/** A person's own copy: `explain.md`'s front matter, on the skill's own body. */
export const PERSONAL_SKILL: Skill = {
  name: 'lo-explain',
  files: [
    ...REFERENCES,
    { path: 'SKILL.md', text: pinned(splitMatter(explain).matter + splitMatter(skill).body) },
  ],
};

/**
 * The name a person's copy had before it was `lo-explain`, which a repository's has now, and the
 * files it had, by their paths in its folder.
 */
export const OLD_PERSONAL = {
  name: REPO_SKILL.name,
  files: ['LICENSE', 'SKILL.md', 'references/format.md', 'references/figures.md'],
} as const;
