/**
 * The overview skill, as `install` writes it: its files' text, built into the checker so that what
 * it installs is exactly what it was built with.
 */

import license from '@lo/skill/LICENSE?raw';
import skill from '@lo/skill/SKILL.md?raw';
import figures from '@lo/skill/references/figures.md?raw';
import format from '@lo/skill/references/format.md?raw';

/** The skill's name, which its folder in a skills folder is named for. */
export const SKILL_NAME = 'lo-overview';

/** One of the skill's files: its path in the skill's folder, and its text. */
export interface SkillFile {
  path: string;
  text: string;
}

/**
 * The skill's files, in the order they're written: `SKILL.md` last, so that an agent never finds
 * the skill without its references.
 */
export const SKILL_FILES: readonly SkillFile[] = [
  { path: 'LICENSE', text: license },
  { path: 'references/format.md', text: format },
  { path: 'references/figures.md', text: figures },
  { path: 'SKILL.md', text: skill },
];
