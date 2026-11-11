import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseJson } from '@nx/devkit';

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
  /** A package that isn't one of the workspace's projects. */
  | { kind: 'package'; name: string }
  /** Files in no project, outside the workspace's `node_modules`. */
  | { kind: 'outside' };

const node: Target = { kind: 'node' };
const electron: Target = { kind: 'electron' };
const computed: Target = { kind: 'computed' };
const outside: Target = { kind: 'outside' };

/** Node decodes a specifier's percent escapes, and `%2e%2e` even counts as `..`. */
const percent = `Node decodes the percent escapes in a module's path and this check doesn't, so write each character as itself`;
/** Node and TypeScript read a `\` in a module's path as `/`. */
const backslash = `Node and TypeScript read a backslash in a module's path as a slash and this check doesn't, so write a slash`;
const url = `that's a URL, which this check can't follow, so import by path or package name`;

/**
 * The files that may use `createRequire` or `getBuiltinModule`, which load modules the check can't
 * follow. Listing them keeps each one in sight in review.
 */
const loaderFiles = new Set([
  // Finds Electron's binary for the smoke test.
  'apps/desktop/e2e/app.ts',
  // Counts the cores in the app's main process.
  'apps/desktop/e2e/background.spec.ts',
  // Finds the fonts' license files, to ship beside the window's files.
  'apps/desktop/electron.vite.config.ts',
  // Loads node:sqlite, which an older Node doesn't have.
  'apps/desktop/src/main/database.ts',
  // Finds the syntax package's folder, for its built grammars.
  'apps/perf/src/main/index.ts',
  // Find the design tokens, and the stylesheets the window's stylesheet imports.
  'packages/desktop/ui/scripts/spacing.test.ts',
  'packages/desktop/ui/scripts/stylesheet.ts',
  'packages/desktop/ui/scripts/theme.ts',
]);

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
  const byFolder = new Map(projects.map((project) => [join(root, project.root), project]));
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

  /**
   * The package a real path is in, when that's in the workspace's `node_modules`, where pnpm
   * installs: the root's, or a project's own, which belongs to that project. A `node_modules`
   * folder anywhere else holds plain files.
   */
  const installedAt = (real: string) => {
    const owner = projectAt(real);
    const folder = owner ? `${owner.root}/node_modules/` : 'node_modules/';
    const where = toSlashes(relative(root, real));
    if (!where.startsWith(folder)) return undefined;
    // pnpm keeps each package in a `node_modules` of its own, inside `.pnpm`.
    const parts = where.slice(folder.length).split('/');
    const { name, rest } = splitPackage(
      parts.slice(parts.lastIndexOf('node_modules') + 1).join('/'),
    );
    return { name, rest, owner };
  };

  const named = (name: string): Target => {
    if (name === 'electron' || name.startsWith('@electron/')) return electron;
    const project = byPackage.get(name);
    return project ? { kind: 'project', project } : { kind: 'package', name };
  };

  /** A package that isn't installed, as `owner`'s `package.json` names it. */
  const declared = (name: string, rest: readonly string[], owner: Project | undefined): Target => {
    const alias = owner && aliases.get(owner)?.get(name);
    if (alias && 'path' in alias) return resolvePath(join(alias.path, ...rest));
    return named(alias?.name ?? name);
  };

  /** Where a path lands, followed through symlinks. In the workspace's `node_modules`, a package. */
  const resolvePath = (path: string): Target => {
    const real = realPath(path);
    const installed = installedAt(real);
    if (installed) return declared(installed.name, installed.rest, installed.owner);
    const project = projectAt(real);
    return project ? { kind: 'project', project } : outside;
  };

  /**
   * Why `owner` may not reach `path`, which a relative specifier, or a mapping in a `package.json`,
   * writes inside `home`'s folder. Followed through symlinks, it stays there too, unless it lands
   * in the workspace's `node_modules`, where it reaches a package. A project whose own folder is a
   * symlink fails every path here, which errs on the safe side.
   */
  const pathVerdict = (
    path: string,
    home: Project,
    owner: Project,
    test: boolean,
  ): string | undefined => {
    const target = resolvePath(path);
    if (projectAt(path) !== home) return leaves(home, target);
    const real = realPath(path);
    if (projectAt(real) !== home && !installedAt(real)) {
      return leaves(home, target, 'through a symlink, ');
    }
    return problem(owner, test, target);
  };

  /**
   * Why `owner` may not import `rest` from `home` by its package name. As in Node, the `exports` in
   * `home`'s `package.json` map the subpath when it has them, and either way the path stays in
   * `home`'s folder. A subpath the exports leave out doesn't load, so only the tags apply.
   */
  const projectVerdict = (
    home: Project,
    rest: readonly string[],
    owner: Project,
    test: boolean,
  ): string | undefined => {
    const tags = problem(owner, test, { kind: 'project', project: home });
    if (tags) return tags;
    const folder = join(root, home.root);
    const exports = manifests.get(home)?.json.exports;
    if (exports === undefined) return pathVerdict(join(folder, ...rest), home, owner, test);
    const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`;
    for (const target of mapped(exportsMap(exports), subpath) ?? []) {
      const reason = mappingVerdict(target, folder, home, owner, test);
      if (reason) return `${home.root}/package.json maps it to ${target}; ${reason}`;
    }
    return undefined;
  };

  /** Why `owner` may not import `rest` from the package in `folder`. */
  const folderVerdict = (
    folder: string,
    rest: readonly string[],
    owner: Project,
    test: boolean,
  ): string | undefined => {
    const project = byFolder.get(realPath(folder));
    if (project) return projectVerdict(project, rest, owner, test);
    return problem(owner, test, resolvePath(join(folder, ...rest)));
  };

  /** Why `owner` may not import the package `specifier` names, found as Node finds it from `folder`. */
  const packageVerdict = (
    specifier: string,
    folder: string,
    owner: Project,
    test: boolean,
  ): string | undefined => {
    const { name, rest } = splitPackage(specifier);
    for (let dir = folder; ; dir = dirname(dir)) {
      const installed = join(dir, 'node_modules', name);
      if (existsSync(installed)) return folderVerdict(installed, rest, owner, test);
      if (dirname(dir) === dir) break;
    }
    // Not installed yet, so as `owner`'s `package.json` names it.
    const alias = aliases.get(owner)?.get(name);
    if (alias && 'path' in alias) return folderVerdict(alias.path, rest, owner, test);
    const target = named(alias?.name ?? name);
    if (target.kind === 'project') return projectVerdict(target.project, rest, owner, test);
    return problem(owner, test, target);
  };

  /** Why `owner` may not import `specifier`, a built-in module's name or a package's, from `folder`. */
  const bareVerdict = (
    specifier: string,
    folder: string,
    owner: Project,
    test: boolean,
  ): string | undefined => {
    if (specifier.startsWith('node:') || isBuiltin(specifier)) return problem(owner, test, node);
    if (/^[a-z][a-z\d+.-]*:/i.test(specifier)) return url;
    return packageVerdict(specifier, folder, owner, test);
  };

  /**
   * Why `owner` may not reach `target`, which the `imports` or `exports` of a `package.json` in
   * `folder`, inside `home`'s folder, map to. A path stays in `home`'s folder.
   */
  const mappingVerdict = (
    target: string,
    folder: string,
    home: Project,
    owner: Project,
    test: boolean,
  ): string | undefined => {
    if (target.includes('%')) return percent;
    if (target.includes('\\')) return backslash;
    if (target.startsWith('.') || target.startsWith('/')) {
      return pathVerdict(resolve(folder, target), home, owner, test);
    }
    return bareVerdict(target, folder, owner, test);
  };

  /**
   * Why `owner` may not import `specifier`, a `#name`, from `folder`. As in Node, the `imports` of
   * the nearest `package.json` map it. One they don't map doesn't load in Node, so something else
   * would have to resolve it, and where it goes can't be checked.
   */
  const importsVerdict = (
    specifier: string,
    folder: string,
    owner: Project,
    test: boolean,
  ): string | undefined => {
    const top = join(root, owner.root);
    const scope = scopeOf(folder, top);
    const file = toSlashes(relative(root, join(scope, 'package.json')));
    const manifest =
      scope === top ? manifests.get(owner) : readManifest(join(scope, 'package.json'));
    const targets = mapped(manifest?.json.imports, specifier);
    if (!targets) return `${file} doesn't map it in imports, so where it goes can't be checked`;
    for (const target of targets) {
      const reason = mappingVerdict(target, scope, owner, owner, test);
      if (reason) return `${file} maps it to ${target}; ${reason}`;
    }
    return undefined;
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
    // Without a query or fragment, keeping a `#name`'s own `#`.
    const path = specifier.slice(0, 1) + specifier.slice(1).replace(/[?#].*$/, '');
    if (path.includes('%')) return percent;
    if (path.includes('\\')) return backslash;
    if (reference === 'types') {
      if (specifier === 'node' || specifier === '@types/node') return problem(owner, test, node);
      return packageVerdict(specifier, folder, owner, test);
    }
    if (reference === 'path' || path.startsWith('.') || path.startsWith('/')) {
      return pathVerdict(resolve(folder, path), owner, owner, test);
    }
    if (path.startsWith('#')) return importsVerdict(path, folder, owner, test);
    return bareVerdict(path, folder, owner, test);
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
        if (found.loader) {
          if (found.loader !== 'require' && loaderFiles.has(path)) continue;
          violations.push({
            where: `${path}:${found.line}`,
            message:
              found.loader === 'require'
                ? `uses ${found.specifier}, but the check follows require only in a call that names its module, such as require('./x.js').`
                : `uses ${found.specifier}, which loads modules the check can't follow, so only the files listed in scripts/boundaries/check.ts may use it.`,
          });
          continue;
        }
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
        // A pattern's `*` stands for one path segment here. An import through a pattern is
        // checked where it's made, with what the `*` matches.
        const reason = mappingVerdict(target.replaceAll('*', 'x'), folder, project, project, false);
        if (!reason) continue;
        violations.push({
          where: at(key),
          message: `maps "${key}" to "${target}" in ${field}: ${reason}.`,
        });
      }
    }
  }

  violations.push(
    ...checkRootManifest(root, byPackage),
    ...checkOverrides(root),
    ...checkTsconfigs(root, ['', ...projects.map((project) => project.root)]),
  );

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
        : { kind: 'package', name: target };
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
  if (target.kind === 'outside') {
    return `that lands outside every project, and projects import only their own files and packages`;
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

/** Why a path written in `home`'s folder may not land on `target`, which is outside that folder. */
function leaves(home: Project, target: Target, how = ''): string {
  const why =
    target.kind === 'project'
      ? 'projects reach each other only by package name'
      : target.kind === 'outside'
        ? 'projects import only their own files and packages'
        : 'packages are imported by name';
  return `${how}that leaves ${home.name}'s folder for ${landing(target)}, and ${why}`;
}

function landing(target: Target): string {
  if (target.kind === 'project') return target.project.name;
  if (target.kind === 'electron') return 'Electron';
  if (target.kind === 'package') return `the package ${target.name}`;
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

/**
 * pnpm's overrides and package extensions apply across the workspace, past the checks on each
 * project's own dependencies, so none of them points a dependency at a folder with `link:` or
 * `file:`. They live in `pnpm-workspace.yaml`, or in the root `package.json`'s `pnpm` and
 * `resolutions`.
 */
function checkOverrides(root: string): Violation[] {
  const violations: Violation[] = [];
  const folder = /(?:^|[\s"'{[,:])(?:link|file):/;
  const workspace = join(root, 'pnpm-workspace.yaml');
  // Read line by line rather than parsed: a `link:` or `file:` value anywhere in it is refused.
  const lines = existsSync(workspace) ? readFileSync(workspace, 'utf8').split('\n') : [];
  for (const [index, line] of lines.entries()) {
    const code = line.replace(/(?:^|\s)#.*$/, '');
    if (!folder.test(code)) continue;
    violations.push({
      where: `pnpm-workspace.yaml:${index + 1}`,
      message: `points a dependency at a folder (${code.trim()}), but overrides and package extensions apply across the workspace, past the checks on each project's dependencies.`,
    });
  }
  const manifest = readManifest(join(root, 'package.json'));
  for (const field of ['pnpm', 'resolutions'] as const) {
    for (const [key, spec] of stringsIn(manifest?.json[field], field)) {
      if (!spec.startsWith('link:') && !spec.startsWith('file:')) continue;
      violations.push({
        where: `package.json:${lineOf(manifest?.text ?? '', key)}`,
        message: `points "${key}" at a folder (${spec}), but overrides and package extensions apply across the workspace, past the checks on each project's dependencies.`,
      });
    }
  }
  return violations;
}

/**
 * `paths` would let an import reach a project without its package name. Checks the tsconfig files
 * in each of `folders`, relative to `root`, and every tsconfig they reach through `extends` and
 * `references`. One outside the workspace's own files, such as a package's, is reported where
 * it's reached from.
 */
function checkTsconfigs(root: string, folders: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  const queue: { file: string; via?: { where: string; how: string } }[] = folders.flatMap(
    (folder) =>
      readdirSync(join(root, folder))
        .filter((name) => /^tsconfig.*\.json$/.test(name))
        .toSorted()
        .map((name) => ({ file: join(root, folder, name) })),
  );
  const seen = new Set<string>();
  // The queue grows as tsconfig files lead to others.
  for (const { file, via } of queue) {
    const real = realpathSync(file);
    if (seen.has(real)) continue;
    seen.add(real);
    const where = toSlashes(relative(root, real));
    const own = !where.startsWith('../') && !where.split('/').includes('node_modules');
    const text = readFileSync(real, 'utf8');
    const report = (line: number, message: string) => {
      violations.push(
        own || !via
          ? { where: `${where}:${line}`, message }
          : { where: via.where, message: `${via.how}, which ${message}` },
      );
    };

    let config: Record<string, unknown>;
    try {
      config = asObject(parseJson(text));
    } catch {
      report(1, `doesn't parse, so whether it sets compilerOptions.paths can't be checked.`);
      continue;
    }
    // Parsed rather than searched, so comments and escapes in its keys can't hide `paths`.
    if (Object.hasOwn(objectAt(config, 'compilerOptions'), 'paths')) {
      report(
        lineOf(text, 'paths'),
        'sets compilerOptions.paths, but projects reach each other only by package name.',
      );
    }
    const follow = (key: string, spec: string, next: string | undefined) => {
      if (!next) return;
      const how = `${key} ${spec}`;
      queue.push({ file: next, via: own ? { where: `${where}:${lineOf(text, key)}`, how } : via });
    };
    for (const spec of listOf(config.extends)) {
      if (typeof spec === 'string') follow('extends', spec, extendedTsconfig(spec, dirname(real)));
    }
    for (const reference of listOf(config.references)) {
      const spec = isRecord(reference) ? reference.path : undefined;
      if (typeof spec === 'string') {
        follow('references', spec, referencedTsconfig(resolve(dirname(real), spec)));
      }
    }
  }
  return violations;
}

/** The tsconfig an `extends` names, found as TypeScript finds it, or nothing if it isn't there. */
function extendedTsconfig(spec: string, folder: string): string | undefined {
  if (spec.startsWith('.') || isAbsolute(spec)) return jsonFile(resolve(folder, spec));
  const { name, rest } = splitPackage(spec);
  for (let dir = folder; ; dir = dirname(dir)) {
    const installed = join(dir, 'node_modules', name);
    if (existsSync(installed)) {
      if (rest.length > 0) return jsonFile(join(installed, ...rest));
      const field = readManifest(join(installed, 'package.json'))?.json.tsconfig;
      return jsonFile(join(installed, typeof field === 'string' ? field : 'tsconfig.json'));
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** `path`, or `path.json`, whichever is a file. */
function jsonFile(path: string): string | undefined {
  return [path, `${path}.json`].find(isFile);
}

/** The tsconfig a `references` entry names: a file, or a folder's `tsconfig.json`. */
function referencedTsconfig(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return statSync(path).isDirectory() ? [join(path, 'tsconfig.json')].find(isFile) : path;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** The folder of the `package.json` nearest `folder`, looking no higher than `top`. */
function scopeOf(folder: string, top: string): string {
  for (let dir = folder; dir !== top && dir.startsWith(top); dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return top;
}

/**
 * What `key` maps to in an `imports` or `exports` field, matched as Node matches it: an entry
 * named `key`, or else the pattern with the longest part before its `*`, whose match takes each
 * `*`'s place in the targets. Every condition's target counts, and every fallback's, since any of
 * them may be the one that loads. Nothing when no entry matches.
 */
function mapped(map: unknown, key: string): string[] | undefined {
  if (!isRecord(map)) return undefined;
  if (!key.includes('*') && Object.hasOwn(map, key)) return targetsOf(map[key]);
  const patterns = Object.keys(map)
    .filter((pattern) => pattern.split('*').length === 2)
    .toSorted((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  for (const pattern of patterns) {
    const [base = '', trailer = ''] = pattern.split('*');
    const ends = trailer === '' || (key.endsWith(trailer) && key.length >= pattern.length);
    if (key.startsWith(base) && key !== base && ends) {
      return targetsOf(map[pattern], key.slice(base.length, key.length - trailer.length));
    }
  }
  return undefined;
}

/** Every string in a target, through conditions and fallbacks, with `match` in place of each `*`. */
function targetsOf(target: unknown, match?: string): string[] {
  if (typeof target === 'string') {
    return [match === undefined ? target : target.replaceAll('*', () => match)];
  }
  if (Array.isArray(target)) return target.flatMap((item) => targetsOf(item, match));
  if (isRecord(target)) return Object.values(target).flatMap((item) => targetsOf(item, match));
  return [];
}

/** An `exports` field by subpath: a lone target, or conditions, stand for ".". */
function exportsMap(exports: unknown): unknown {
  const bySubpath = isRecord(exports) && Object.keys(exports).some((key) => key.startsWith('.'));
  return bySubpath ? exports : { '.': exports };
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

/** Every string in a JSON value, with the key it's directly under. */
function* stringsIn(value: unknown, key: string): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [key, value];
  } else if (Array.isArray(value)) {
    for (const item of value) yield* stringsIn(item, key);
  } else if (isRecord(value)) {
    for (const [name, inner] of Object.entries(value)) yield* stringsIn(inner, name);
  }
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
