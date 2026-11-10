import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { importsOf, ParseError, type Import } from './imports.ts';

/** A project as Nx describes it. */
export interface Project {
  name: string;
  /** Its folder, relative to the workspace root, with `/` between parts. */
  root: string;
  tags: readonly string[];
  /** The `name` in its `package.json`, which other projects import it by. */
  packageName?: string | undefined;
}

export interface Violation {
  /** A project's folder, or a file and line, relative to the workspace root. */
  where: string;
  message: string;
}

const CORE = 'platform:core';
const MIT = 'license:mit';

/** The folders whose projects take a platform tag, and the tag each one takes. */
const platformFolders = [
  { folder: 'packages/core/', tag: CORE },
  { folder: 'packages/desktop/', tag: 'platform:desktop' },
];

const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** Dependencies, build output and test data. Folders starting with a dot are skipped too. */
const skippedFolders = new Set(['node_modules', 'dist', 'fixtures']);

/** Tests are `*.test.*` files and anything in a `test/` or `e2e/` folder. */
export function isTest(pathInProject: string): boolean {
  return /(?:^|\/)(?:test|e2e)\//.test(pathInProject) || /\.test\.[^/]+$/.test(pathInProject);
}

type Target =
  | { kind: 'project'; project: Project }
  | { kind: 'node' }
  | { kind: 'electron' }
  | { kind: 'other' };

/**
 * Checks every project's tags, and every import in every project's source files, against the
 * workspace's boundary rules. `projects` comes from Nx; the files are read from disk.
 */
export function checkBoundaries(workspaceRoot: string, projects: readonly Project[]): Violation[] {
  const violations = checkTags(workspaceRoot, projects);
  const byPackage = new Map(projects.map((project) => [project.packageName, project]));
  const roots = new Set(projects.map((project) => project.root));

  const projectAt = (path: string): Project | undefined => {
    const where = toSlashes(relative(workspaceRoot, path));
    let found: Project | undefined;
    for (const project of projects) {
      const inside = where === project.root || where.startsWith(`${project.root}/`);
      if (inside && project.root.length > (found?.root.length ?? -1)) found = project;
    }
    return found;
  };

  const resolveImport = (from: string, { specifier, types }: Import): Target => {
    const path = specifier.replace(/[?#].*$/, '');
    if (types) {
      if (path === 'node') return { kind: 'node' };
      if (path === 'electron') return { kind: 'electron' };
      return { kind: 'other' };
    }
    if (path.startsWith('.') || path.startsWith('/')) {
      const project = projectAt(resolve(dirname(from), path));
      return project ? { kind: 'project', project } : { kind: 'other' };
    }
    if (path.startsWith('node:') || isBuiltin(path)) return { kind: 'node' };
    if (path === 'electron' || path.startsWith('electron/') || path.startsWith('@electron/')) {
      return { kind: 'electron' };
    }
    const parts = path.split('/');
    const packageName = path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const project = byPackage.get(packageName);
    return project ? { kind: 'project', project } : { kind: 'other' };
  };

  for (const project of projects) {
    for (const file of sourceFiles(join(workspaceRoot, project.root), project.root, roots)) {
      const path = toSlashes(relative(workspaceRoot, file));
      const test = isTest(path.slice(project.root.length + 1));
      let imports: Import[];
      try {
        imports = importsOf(file, readFileSync(file, 'utf8'));
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        violations.push({
          where: `${path}:${error.line}`,
          message: `doesn't parse (${error.message}), so its imports can't be checked.`,
        });
        continue;
      }
      for (const found of imports) {
        const message = problem(project, test, resolveImport(file, found), found.specifier);
        if (message) violations.push({ where: `${path}:${found.line}`, message });
      }
    }
  }
  return violations.toSorted((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }));
}

function problem(
  from: Project,
  test: boolean,
  target: Target,
  specifier: string,
): string | undefined {
  if (target.kind === 'project') {
    const to = target.project;
    if (to === from) return undefined;
    if (to.root.startsWith('apps/')) {
      return `imports the app ${to.name} (${specifier}). Nothing imports an app.`;
    }
    if (to.root === 'testing') {
      if (test) return undefined;
      return `imports testing (${specifier}). Only tests do: *.test.* files and the test/ and e2e/ folders.`;
    }
    if (from.tags.includes(CORE) && !to.tags.includes(CORE)) {
      return `imports ${to.name} (${specifier}), which isn't a core project. Core projects import only core projects.`;
    }
    if (from.tags.includes(MIT) && !to.tags.includes(MIT)) {
      return `imports ${to.name} (${specifier}), which isn't MIT-licensed. MIT projects import only MIT projects, so they stay MIT.`;
    }
    return undefined;
  }
  if (!from.tags.includes(CORE)) return undefined;
  if (target.kind === 'electron') {
    return `imports ${specifier}. Core projects run anywhere, so they can't use Electron.`;
  }
  if (target.kind === 'node' && !test) {
    return `imports ${specifier}, a Node built-in. Core projects run anywhere, so only their tests can use Node.`;
  }
  return undefined;
}

function checkTags(workspaceRoot: string, projects: readonly Project[]): Violation[] {
  const violations: Violation[] = [];
  for (const { root, tags } of projects) {
    const platforms = tags.filter((tag) => tag.startsWith('platform:'));
    const expected = platformFolders.find(({ folder }) => `${root}/`.startsWith(folder));
    if (expected && (platforms.length !== 1 || platforms[0] !== expected.tag)) {
      violations.push({
        where: root,
        message: `is in ${expected.folder}, so it takes the tag ${expected.tag}${tagsNote(platforms)}.`,
      });
    }
    if (!expected && platforms.length > 0) {
      violations.push({
        where: root,
        message: `has ${platforms.join(', ')}, but only projects in ${platformFolders.map(({ folder }) => folder).join(' and ')} take a platform tag.`,
      });
    }
    for (const license of tags.filter((tag) => tag.startsWith('license:') && tag !== MIT)) {
      violations.push({
        where: root,
        message: `has ${license}, but the only license tag is ${MIT}. Projects without it are GPL-3.0.`,
      });
    }
    if (tags.includes(MIT) && !existsSync(join(workspaceRoot, root, 'LICENSE'))) {
      violations.push({
        where: root,
        message: `is tagged ${MIT}, so it needs the MIT license in its own LICENSE file.`,
      });
    }
  }
  return violations;
}

function tagsNote(platforms: readonly string[]): string {
  return platforms.length === 0 ? ', and has none' : `, not ${platforms.join(', ')}`;
}

/** The project's source files, leaving out projects nested inside it. */
function* sourceFiles(folder: string, root: string, roots: ReadonlySet<string>): Generator<string> {
  const entries = readdirSync(folder, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || skippedFolders.has(entry.name)) continue;
      const nested = `${root}/${entry.name}`;
      if (roots.has(nested)) continue;
      yield* sourceFiles(path, nested, roots);
    } else if (entry.isFile() && sourceFile.test(entry.name)) {
      yield path;
    }
  }
}

function toSlashes(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}
