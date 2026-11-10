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

/** An edge in Nx's project graph: project names, or `npm:<package>` for a target outside it. */
export interface Edge {
  source: string;
  target: string;
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

/** The only aliases the root `package.json` may list: TypeScript 6 for Nx, and TypeScript 7. */
const toolingAliases = new Map([
  ['typescript', '@typescript/typescript6'],
  ['@typescript/native', 'typescript'],
]);

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
 * Checks every project's tags, `package.json`, tsconfig files and source files, and the edges of
 * Nx's project graph, against the workspace's boundary rules. Imports resolve the way Node finds
 * them: through the `node_modules` folders from the importing file up, and through symlinks to
 * real paths. `projects` and `edges` come from Nx; everything else is read from disk.
 */
export function checkBoundaries(
  workspaceRoot: string,
  projects: readonly Project[],
  edges: readonly Edge[] = [],
): Violation[] {
  // Real paths throughout, so that a path through a symlink lands in the folder it points to.
  const root = realpathSync(workspaceRoot);
  const violations = checkTags(root, projects);
  const byPackage = new Map(projects.map((project) => [project.packageName, project]));
  const byName = new Map(projects.map((project) => [project.name, project]));
  const roots = new Set(projects.map((project) => project.root));
  const manifests = new Map(
    projects.map((project) => [project, readManifest(join(root, project.root, 'package.json'))]),
  );
  const aliases = new Map(
    projects.map((project) => [
      project,
      aliasesOf(manifests.get(project), join(root, project.root)),
    ]),
  );

  /** The project whose folder holds `path`, as written: symlinks aren't followed. */
  const projectAt = (path: string): Project | undefined => {
    const where = toSlashes(relative(root, path));
    let found: Project | undefined;
    for (const project of projects) {
      const inside = where === project.root || where.startsWith(`${project.root}/`);
      if (inside && project.root.length > (found?.root.length ?? -1)) found = project;
    }
    return found;
  };

  const named = (name: string): Target => {
    if (name === 'electron' || name.startsWith('@electron/')) return electron;
    const project = byPackage.get(name);
    return project ? { kind: 'project', project } : other;
  };

  /** A package that isn't installed, as `owner`'s `package.json` names it. */
  const declared = (name: string, rest: readonly string[], owner: Project | undefined): Target => {
    const alias = owner && aliases.get(owner)?.get(name);
    if (alias && 'path' in alias) return resolvePath(join(alias.path, ...rest));
    return named(alias?.name ?? name);
  };

  /** A path, followed through symlinks. One that runs through `node_modules` names a package. */
  const resolvePath = (path: string): Target => {
    const parts = toSlashes(realPath(path)).split('/');
    const modules = parts.lastIndexOf('node_modules');
    if (modules !== -1) {
      const { name, rest } = splitPackage(parts.slice(modules + 1).join('/'));
      return declared(name, rest, projectAt(parts.slice(0, modules).join('/')));
    }
    const project = projectAt(parts.join('/'));
    return project ? { kind: 'project', project } : other;
  };

  /** A package name and subpath, found the way Node finds it from `folder`. */
  const resolvePackage = (specifier: string, folder: string, owner: Project): Target => {
    const { name, rest } = splitPackage(specifier);
    for (let dir = folder; ; dir = dirname(dir)) {
      const installed = join(dir, 'node_modules', name);
      if (existsSync(installed)) return resolvePath(join(installed, ...rest));
      if (dirname(dir) === dir) break;
    }
    return declared(name, rest, owner);
  };

  /**
   * Why `owner` may not refer to `specifier` from `folder`, or nothing when it may. A relative
   * path stays inside the project's folder: projects reach each other by package name.
   */
  const verdict = (
    specifier: string,
    folder: string,
    owner: Project,
    test: boolean,
    reference?: Import['reference'],
  ): string | undefined => {
    if (reference === 'types') {
      if (specifier === 'node' || specifier === '@types/node') return problem(owner, test, node);
      return problem(owner, test, resolvePackage(specifier, folder, owner));
    }
    // `#name` resolves through the package's `imports`, which is checked on its own.
    if (specifier.startsWith('#') && reference !== 'path') return undefined;
    const path = specifier.replace(/[?#].*$/, '');
    if (reference === 'path' || path.startsWith('.') || path.startsWith('/')) {
      const absolute = resolve(folder, path);
      if (projectAt(absolute) !== owner) {
        return `that leaves ${owner.name}'s folder for ${landing(resolvePath(absolute))}, and projects reach each other only by package name`;
      }
      return problem(owner, test, resolvePath(absolute));
    }
    if (path.startsWith('node:') || isBuiltin(path)) return problem(owner, test, node);
    return problem(owner, test, resolvePackage(path, folder, owner));
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
        const reason = found.computed
          ? problem(project, test, computed)
          : verdict(found.specifier, dirname(file), project, test, found.reference);
        if (!reason) continue;
        const verb = found.computed ? 'loads' : found.reference ? 'references' : 'imports';
        violations.push({
          where: `${path}:${found.line}`,
          message: `${verb} ${found.specifier}: ${reason}.`,
        });
      }
    }
    violations.push(...checkTsconfigs(folder, `${project.root}/`));

    const manifest = manifests.get(project);
    if (!manifest) continue;
    const at = (key: string) => `${project.root}/package.json:${lineOf(manifest.text, key)}`;
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(objectAt(manifest.json, field))) {
        const reason = problem(project, field === 'devDependencies', declared(name, [], project));
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
        const reason = verdict(target.replaceAll('*', 'x'), folder, project, false);
        if (!reason) continue;
        violations.push({
          where: at(key),
          message: `maps "${key}" to "${target}" in ${field}: ${reason}.`,
        });
      }
    }
  }

  violations.push(...checkRootManifest(root, byPackage), ...checkTsconfigs(root, ''));

  // A backstop for anything the file checks miss: every edge Nx found keeps the same rules. Nx
  // doesn't say which file an edge comes from, so tests' allowances apply.
  for (const { source, target } of edges) {
    const from = byName.get(source);
    const project = byName.get(target);
    if (!from) continue;
    const to: Target = target.startsWith('npm:')
      ? named(splitPackage(target.slice('npm:'.length)).name)
      : project
        ? { kind: 'project', project }
        : other;
    const reason = problem(from, true, to);
    if (!reason) continue;
    violations.push({
      where: from.root,
      message: `depends on ${target} in Nx's project graph: ${reason}.`,
    });
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

function landing(target: Target): string {
  if (target.kind === 'project') return target.project.name;
  if (target.kind === 'electron') return 'Electron';
  return 'files outside any project';
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

/** The root `package.json` holds the repo's tooling, so it lists no workspace package or alias. */
function checkRootManifest(
  root: string,
  byPackage: ReadonlyMap<string | undefined, Project>,
): Violation[] {
  const manifest = readManifest(join(root, 'package.json'));
  if (!manifest) return [];
  const violations: Violation[] = [];
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(objectAt(manifest.json, field))) {
      if (typeof spec !== 'string') continue;
      const alias = aliasOf(spec, root);
      const tooling =
        alias !== undefined && 'name' in alias && toolingAliases.get(name) === alias.name;
      const workspace = byPackage.has(name) || spec.startsWith('workspace:');
      if (!workspace && (!alias || tooling)) continue;
      violations.push({
        where: `package.json:${lineOf(manifest.text, name)}`,
        message: `lists "${name}": ${JSON.stringify(spec)} in ${field}, but the root package.json holds the repo's tooling only: no workspace package, and no alias besides TypeScript's.`,
      });
    }
  }
  return violations;
}

/** `paths` would let an import reach a project without its package name. */
function checkTsconfigs(folder: string, prefix: string): Violation[] {
  const violations: Violation[] = [];
  const files = readdirSync(folder).filter((name) => /^tsconfig.*\.json$/.test(name));
  for (const name of files.toSorted()) {
    const text = readFileSync(join(folder, name), 'utf8');
    const match = /"paths"\s*:/.exec(text);
    if (!match) continue;
    violations.push({
      where: `${prefix}${name}:${text.slice(0, match.index).split('\n').length}`,
      message: `sets compilerOptions.paths, but projects reach each other only by package name.`,
    });
  }
  return violations;
}

function readManifest(path: string): Manifest | undefined {
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

/** A specifier's package name, without any version, and the path parts after it. */
function splitPackage(specifier: string): { name: string; rest: string[] } {
  const parts = specifier.split('/');
  const length = specifier.startsWith('@') ? 2 : 1;
  const name = parts.slice(0, length).join('/');
  const version = name.indexOf('@', 1);
  return { name: version === -1 ? name : name.slice(0, version), rest: parts.slice(length) };
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

/** The line of the first `"key"` in a JSON file's text. */
function lineOf(text: string, key: string): number {
  const index = text.indexOf(JSON.stringify(key));
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
