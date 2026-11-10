import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

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

/** The folders whose projects, and every project inside them, are MIT-licensed. */
const mitFolders = ['packages/core/markdown', 'packages/core/artifact', 'skill'];

const dependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
] as const;

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
  /** A module chosen at run time. */
  | { kind: 'computed' }
  | { kind: 'other' };

const node: Target = { kind: 'node' };
const electron: Target = { kind: 'electron' };
const computed: Target = { kind: 'computed' };
const other: Target = { kind: 'other' };

/** Where a dependency alias points: another package's name, or a folder. */
type Alias = { name: string } | { path: string };

interface Manifest {
  text: string;
  json: Record<string, unknown>;
}

/**
 * Checks every project's tags, `package.json` and source files against the workspace's boundary
 * rules. `projects` comes from Nx; everything else is read from disk.
 */
export function checkBoundaries(workspaceRoot: string, projects: readonly Project[]): Violation[] {
  // Real paths throughout, so that a path through a symlink lands in the folder it points to.
  const root = realpathSync(workspaceRoot);
  const violations = checkTags(root, projects);
  const byPackage = new Map(projects.map((project) => [project.packageName, project]));
  const roots = new Set(projects.map((project) => project.root));
  const manifests = new Map(projects.map((project) => [project, readManifest(root, project)]));
  const aliases = new Map(
    projects.map((project) => [
      project,
      aliasesOf(manifests.get(project), join(root, project.root)),
    ]),
  );

  const projectAt = (path: string): Project | undefined => {
    const where = toSlashes(relative(root, path));
    let found: Project | undefined;
    for (const project of projects) {
      const inside = where === project.root || where.startsWith(`${project.root}/`);
      if (inside && project.root.length > (found?.root.length ?? -1)) found = project;
    }
    return found;
  };

  /** A package name and subpath, as `owner`'s dependencies resolve it. */
  const resolvePackage = (specifier: string, owner: Project | undefined): Target => {
    const parts = specifier.split('/');
    const length = specifier.startsWith('@') ? 2 : 1;
    const name = parts.slice(0, length).join('/');
    const alias = owner && aliases.get(owner)?.get(name);
    if (alias && 'path' in alias) return resolvePath(join(alias.path, ...parts.slice(length)));
    const real = alias?.name ?? name;
    if (real === 'electron' || real.startsWith('@electron/')) return electron;
    const project = byPackage.get(real);
    return project ? { kind: 'project', project } : other;
  };

  /** A path, followed through symlinks. One that runs through `node_modules` names a package. */
  const resolvePath = (path: string): Target => {
    const parts = toSlashes(realPath(path)).split('/');
    const modules = parts.lastIndexOf('node_modules');
    if (modules !== -1) {
      const owner = projectAt(parts.slice(0, modules).join('/'));
      return resolvePackage(parts.slice(modules + 1).join('/'), owner);
    }
    const project = projectAt(parts.join('/'));
    return project ? { kind: 'project', project } : other;
  };

  const resolveSpecifier = (specifier: string, folder: string, owner: Project): Target => {
    // `#name` resolves through the package's `imports`, which is checked on its own.
    if (specifier.startsWith('#')) return other;
    const path = specifier.replace(/[?#].*$/, '');
    if (path.startsWith('.') || path.startsWith('/')) return resolvePath(resolve(folder, path));
    if (path.startsWith('node:') || isBuiltin(path)) return node;
    return resolvePackage(path, owner);
  };

  const resolveImport = (found: Import, file: string, owner: Project): Target => {
    if (found.computed) return computed;
    if (found.types) {
      if (found.specifier === 'node') return node;
      return found.specifier === 'electron' ? electron : other;
    }
    return resolveSpecifier(found.specifier, dirname(file), owner);
  };

  for (const project of projects) {
    const folder = join(root, project.root);
    for (const file of sourceFiles(folder, project.root, roots)) {
      const path = toSlashes(relative(root, file));
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
        const reason = problem(project, test, resolveImport(found, file, project));
        if (!reason) continue;
        const verb = found.computed ? 'loads' : 'imports';
        violations.push({
          where: `${path}:${found.line}`,
          message: `${verb} ${found.specifier}: ${reason}.`,
        });
      }
    }

    const manifest = manifests.get(project);
    if (!manifest) continue;
    const at = (key: string) => `${project.root}/package.json:${lineOfKey(manifest.text, key)}`;
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(objectAt(manifest.json, field))) {
        const reason = problem(project, field === 'devDependencies', resolvePackage(name, project));
        if (!reason) continue;
        violations.push({
          where: at(name),
          message: `lists "${name}": ${JSON.stringify(spec)} in ${field}: ${reason}.`,
        });
      }
    }
    for (const field of ['imports', 'exports'] as const) {
      for (const [key, target] of mappings(manifest.json[field])) {
        // A pattern's `*` stands for one path segment.
        const reason = problem(
          project,
          false,
          resolveSpecifier(target.replaceAll('*', 'x'), folder, project),
        );
        if (!reason) continue;
        violations.push({
          where: at(key),
          message: `maps "${key}" to "${target}" in ${field}: ${reason}.`,
        });
      }
    }
  }
  return violations.toSorted((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }));
}

/** Why `from` may not use `target`, or nothing when it may. Tests may also use Node and testing. */
function problem(from: Project, test: boolean, target: Target): string | undefined {
  const core = from.tags.includes(CORE);
  if (target.kind === 'project') {
    const to = target.project;
    if (to === from) return undefined;
    if (to.root.startsWith('apps/')) return `that's the app ${to.name}, and nothing imports an app`;
    if (to.root === 'testing') return test ? undefined : `that's testing, which only tests use`;
    if (core && !to.tags.includes(CORE)) {
      return `${to.name} isn't a core project, and core projects import only core projects`;
    }
    if (from.tags.includes(MIT) && !to.tags.includes(MIT)) {
      return `${to.name} isn't MIT-licensed, and MIT projects import only MIT projects, so they stay MIT`;
    }
    return undefined;
  }
  if (!core) return undefined;
  if (target.kind === 'electron') return `core projects run anywhere, so they can't use Electron`;
  if (target.kind === 'node' && !test) {
    return `that's a Node built-in, and core projects run anywhere, so only their tests use Node`;
  }
  if (target.kind === 'computed') {
    return `the module is chosen at run time, so its boundaries can't be checked. Core projects load modules by name`;
  }
  return undefined;
}

function checkTags(root: string, projects: readonly Project[]): Violation[] {
  const violations: Violation[] = [];
  for (const project of projects) {
    const { tags } = project;
    const where = project.root;
    const platforms = tags.filter((tag) => tag.startsWith('platform:'));
    const expected = platformFolders.find(({ folder }) => `${where}/`.startsWith(folder));
    if (expected && (platforms.length !== 1 || platforms[0] !== expected.tag)) {
      violations.push({
        where,
        message: `is in ${expected.folder}, so it takes the tag ${expected.tag}${tagsNote(platforms)}.`,
      });
    }
    if (!expected && platforms.length > 0) {
      violations.push({
        where,
        message: `has ${platforms.join(', ')}, but only projects in ${platformFolders.map(({ folder }) => folder).join(' and ')} take a platform tag.`,
      });
    }
    for (const license of tags.filter((tag) => tag.startsWith('license:') && tag !== MIT)) {
      violations.push({
        where,
        message: `has ${license}, but the only license tag is ${MIT}. Projects without it are GPL-3.0.`,
      });
    }
    const mitFolder = mitFolders.find(
      (folder) => where === folder || where.startsWith(`${folder}/`),
    );
    if (mitFolder && !tags.includes(MIT)) {
      violations.push({
        where,
        message: `is in ${mitFolder}, which is MIT-licensed, so it takes the tag ${MIT}.`,
      });
    }
    if ((mitFolder || tags.includes(MIT)) && !existsSync(join(root, where, 'LICENSE'))) {
      violations.push({
        where,
        message: `is MIT-licensed, so it needs the MIT license in its own LICENSE file.`,
      });
    }
  }
  return violations;
}

function tagsNote(platforms: readonly string[]): string {
  return platforms.length === 0 ? ', and has none' : `, not ${platforms.join(', ')}`;
}

function readManifest(root: string, project: Project): Manifest | undefined {
  const path = join(root, project.root, 'package.json');
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  return { text, json: asObject(JSON.parse(text)) };
}

/**
 * The dependencies a package imports under another name: `npm:` and `workspace:` aliases, and
 * `link:`, `file:` and `workspace:` paths.
 */
function aliasesOf(manifest: Manifest | undefined, folder: string): Map<string, Alias> {
  const aliases = new Map<string, Alias>();
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(objectAt(manifest?.json, field))) {
      if (typeof spec !== 'string') continue;
      const alias = aliasOf(spec, folder);
      if (alias) aliases.set(name, alias);
    }
  }
  return aliases;
}

function aliasOf(spec: string, folder: string): Alias | undefined {
  const packageName = /^((?:@[^/@]+\/)?[^/@]+)(@|$)/;
  if (spec.startsWith('npm:')) {
    const name = packageName.exec(spec.slice('npm:'.length))?.[1];
    return name ? { name } : undefined;
  }
  for (const protocol of ['link:', 'file:']) {
    if (spec.startsWith(protocol)) return { path: resolve(folder, spec.slice(protocol.length)) };
  }
  if (spec.startsWith('workspace:')) {
    const rest = spec.slice('workspace:'.length);
    if (rest.startsWith('.') || rest.startsWith('/')) return { path: resolve(folder, rest) };
    const match = packageName.exec(rest);
    // `workspace:*` and `workspace:^1.0.0` keep the dependency's own name.
    return match?.[2] === '@' && match[1] ? { name: match[1] } : undefined;
  }
  return undefined;
}

/** Every target in an `imports` or `exports` field, with the key it's under. */
function* mappings(value: unknown, key = '.'): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [key, value];
  } else if (Array.isArray(value)) {
    for (const item of value) yield* mappings(item, key);
  } else if (value && typeof value === 'object') {
    for (const [name, inner] of Object.entries(value)) {
      // Keys that start with `.` or `#` are paths; the others are conditions under the same path.
      yield* mappings(inner, name.startsWith('.') || name.startsWith('#') ? name : key);
    }
  }
}

function objectAt(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> {
  return asObject(value?.[key]);
}

function asObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lineOfKey(text: string, key: string): number {
  const quoted = JSON.stringify(key);
  const index = text.indexOf(quoted);
  return index === -1 ? 1 : text.slice(0, index).split('\n').length;
}

/** The real path of `path`'s deepest existing folder, with the rest of `path` after it. */
function realPath(path: string): string {
  const missing: string[] = [];
  let existing = path;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return path;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...missing);
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
