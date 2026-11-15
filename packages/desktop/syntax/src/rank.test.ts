import { beforeAll, describe, expect, test } from 'vitest';

import { diskLoader } from './disk.ts';
import type { Import } from './imports.ts';
import { importOf, join, rank, sameNameLabel, syntaxLabel, type Asking } from './rank.ts';
import { taggedLanguageOfPath } from './tagged.ts';
import { Tagger } from './tags.ts';

let tagger: Tagger;
beforeAll(async () => {
  tagger = await Tagger.create(diskLoader());
});

/** The file at `path` with `text`, as `rank` takes it: its imports read by the tagger. */
async function asking(path: string, text: string): Promise<Asking> {
  const language = taggedLanguageOfPath(path);
  if (!language) throw new Error(`${path} has no tags.`);
  const result = await tagger.symbols(language, text);
  if (!('symbols' in result)) throw new Error(`Not read: ${result.skipped}`);
  return { path, imports: result.symbols.imports, namespace: result.symbols.namespace };
}

/** The candidates at `paths`, ranked for `name`, as `path near`. */
function ranked(name: string, from: Asking, paths: readonly string[]): string[] {
  return rank(
    name,
    from,
    paths.map((path) => ({ path })),
  ).map(({ candidate, near }) => `${candidate.path} ${near}`);
}

/** The ones of `paths` that `from`'s imports say may define `name`, in path order. */
function imported(name: string, from: Asking, paths: readonly string[]): string[] {
  return rank(
    name,
    from,
    paths.map((path) => ({ path })),
  )
    .filter(({ near, label }) => near !== 'file' && label === syntaxLabel)
    .map(({ candidate }) => candidate.path)
    .toSorted();
}

describe('rank', () => {
  test('puts the same file first, then its folder, then an import, then the rest, by path', async () => {
    const from = await asking('src/app/view.ts', "import { parse } from '../text/parse.ts';\n");

    expect(
      ranked('parse', from, [
        'test/helpers/parse.ts',
        'src/text/parse.ts',
        'src/app/view.ts',
        'lib/parse.ts',
        'src/app/parse.ts',
        'src/app/view.ts',
      ]),
    ).toEqual([
      'src/app/view.ts file',
      'src/app/view.ts file',
      'src/app/parse.ts folder',
      'src/text/parse.ts import',
      'lib/parse.ts name',
      'test/helpers/parse.ts name',
    ]);
  });

  test('keeps the order a file gives its definitions in', () => {
    const from: Asking = { path: 'a.py', imports: [] };
    const candidates = [
      { path: 'b.py', line: 9 },
      { path: 'b.py', line: 2 },
      { path: 'a.py', line: 4 },
    ];

    expect(rank('x', from, candidates).map(({ candidate }) => candidate)).toEqual([
      { path: 'a.py', line: 4 },
      { path: 'b.py', line: 9 },
      { path: 'b.py', line: 2 },
    ]);
  });

  test('says when only the name links an answer to the asking file', async () => {
    const from = await asking('web/main.ts', "import { Button } from './ui/button.tsx';\n");
    const labels = rank(
      'Button',
      from,
      ['web/main.ts', 'web/other.tsx', 'web/ui/button.tsx', 'docs/button.js'].map((path) => ({
        path,
      })),
    ).map(({ candidate, label }) => `${candidate.path} ${label}`);

    expect(labels).toEqual([
      `web/main.ts ${syntaxLabel}`,
      `web/other.tsx ${sameNameLabel}`,
      `web/ui/button.tsx ${syntaxLabel}`,
      `docs/button.js ${sameNameLabel}`,
    ]);
  });

  test("links a Go package's files to each other, since they share its names", async () => {
    const from = await asking('store/store.go', 'package store\n');
    const labels = rank('Open', from, [{ path: 'store/open.go' }, { path: 'cmd/open.go' }]).map(
      ({ label }) => label,
    );

    expect(labels).toEqual([syntaxLabel, sameNameLabel]);
  });

  test('a same-folder answer an import names is linked too', async () => {
    const from = await asking('pkg/app.py', 'from .models import User\n');

    expect(rank('User', from, [{ path: 'pkg/models.py' }, { path: 'pkg/admin.py' }])).toEqual([
      { candidate: { path: 'pkg/admin.py' }, near: 'folder', label: sameNameLabel },
      { candidate: { path: 'pkg/models.py' }, near: 'folder', label: syntaxLabel },
    ]);
  });

  test('leaves out definitions in languages the asking file can’t call', async () => {
    const script = await asking('src/a.ts', '');
    const java = await asking('src/A.java', 'package src;\n');

    expect(
      ranked('f', script, ['src/b.js', 'src/c.tsx', 'src/d.py', 'src/e.go', 'README.md']),
    ).toEqual(['src/b.js folder', 'src/c.tsx folder']);
    expect(ranked('f', java, ['src/B.kt', 'src/C.java', 'src/D.cs'])).toEqual([
      'src/B.kt folder',
      'src/C.java folder',
    ]);
  });
});

describe('import guesses', () => {
  test('TypeScript and JavaScript: relative paths, with any script extension or an index', async () => {
    const parse = await asking('web/src/app.ts', "import { parse } from './text/parse.js';\n");
    const ui = await asking('web/src/app.ts', "import Button from '../ui';\n");
    const required = await asking('web/src/app.ts', "const { load } = require('./io/load.cjs');\n");
    const here = await asking('web/src/lib/app.ts', "export { round } from '.';\n");
    const packages = await asking(
      'web/src/app.ts',
      "import { z } from 'zod';\nimport { theme } from '@/theme';\n",
    );

    expect(
      imported('parse', parse, [
        'web/src/text/parse.ts',
        'web/src/text/parse.d.ts',
        'web/src/text/parse/index.ts',
        'web/src/text/parse.py',
        'web/text/parse.ts',
      ]),
    ).toEqual(['web/src/text/parse.d.ts', 'web/src/text/parse.ts', 'web/src/text/parse/index.ts']);
    expect(imported('Button', ui, ['web/ui/index.tsx', 'web/ui.ts', 'web/ui/button.tsx'])).toEqual([
      'web/ui.ts',
      'web/ui/index.tsx',
    ]);
    expect(imported('load', required, ['web/src/io/load.cjs', 'web/src/io/load/main.js'])).toEqual([
      'web/src/io/load.cjs',
    ]);
    expect(imported('round', here, ['web/src/lib/index.js', 'web/src/round.ts'])).toEqual([
      'web/src/lib/index.js',
    ]);
    // A file imported can be a class or namespace whose members are used, so it counts for any name.
    expect(imported('area', parse, ['web/src/text/parse.ts'])).toEqual(['web/src/text/parse.ts']);
    // A package, or a path alias only the project's configuration knows, names no file.
    expect(
      imported('z', packages, ['node_modules/zod/index.d.ts', 'zod.ts', 'web/src/theme.ts']),
    ).toEqual([]);
    expect(imported('theme', packages, ['web/src/theme.ts', 'web/theme.ts'])).toEqual([]);
  });

  test('Python: `from` modules anywhere, relative ones beside the file, and modules imported whole', async () => {
    const from = await asking(
      'app/api/views.py',
      [
        'from app.models import User',
        'from .forms import Form',
        'from ..core import settings',
        'import app.auth.tokens as tokens',
      ].join('\n'),
    );
    const paths = [
      'app/models.py',
      'src/app/models/__init__.py',
      'lib/myapp/models.py',
      'app/api/forms.py',
      'other/forms.py',
      'app/core/__init__.py',
      'app/core/settings.py',
      'app/auth/tokens.py',
    ];

    expect(imported('User', from, paths)).toEqual([
      // Modules imported whole, whose names the file uses through them.
      'app/auth/tokens.py',
      'app/core/settings.py',
      'app/models.py',
      'src/app/models/__init__.py',
    ]);
    expect(imported('Form', from, paths)).toContain('app/api/forms.py');
    expect(imported('Form', from, paths)).not.toContain('other/forms.py');
    // `settings` may be in `app.core`, or be a module of it.
    expect(imported('settings', from, paths)).toEqual([
      'app/auth/tokens.py',
      'app/core/__init__.py',
      'app/core/settings.py',
    ]);
    expect(imported('DEBUG', from, paths)).toEqual(['app/auth/tokens.py', 'app/core/settings.py']);
    expect(imported('DEBUG', from, ['lib/myapp/models.py'])).toEqual([]);
  });

  test('Rust: `crate::`, `self::`, `super::` and `mod` from the crate the file is in', async () => {
    const from = await asking(
      'crates/review/src/stacks/order.rs',
      [
        'use crate::files::{Path, parse};',
        'use super::layer::Layer;',
        'use self::sort::by_base;',
        'use std::collections::HashMap;',
        'use other_crate::Thing;',
        'mod sort;',
        '#[cfg(test)]',
        'mod tests {',
        '    use super::*;',
        '}',
      ].join('\n'),
    );
    const paths = [
      'crates/review/src/files.rs',
      'crates/review/src/files/mod.rs',
      'crates/other/src/files.rs',
      'crates/review/src/stacks/layer.rs',
      'crates/review/src/stacks/order/sort.rs',
      'crates/review/src/stacks/order/sort/mod.rs',
      'crates/review/src/stacks.rs',
      'crates/other_crate/src/lib.rs',
    ];

    // `mod sort;` is a module the file uses names through, so it counts for any name.
    const sort = [
      'crates/review/src/stacks/order/sort.rs',
      'crates/review/src/stacks/order/sort/mod.rs',
    ];
    expect(imported('Path', from, paths)).toEqual([
      'crates/review/src/files.rs',
      'crates/review/src/files/mod.rs',
      ...sort,
    ]);
    expect(imported('Layer', from, paths)).toEqual(['crates/review/src/stacks/layer.rs', ...sort]);
    expect(imported('by_base', from, paths)).toEqual(sort);
    // `use super::*` in a module written inline is about this file, not the module above it.
    expect(imported('anything', from, paths)).toEqual(sort);
    // Other crates' paths name no file.
    expect(imported('Thing', from, ['crates/other_crate/src/lib.rs'])).toEqual([]);
  });

  test('Go: the package in a folder the import path ends with, for its exported names', async () => {
    const from = await asking(
      'cmd/server/main.go',
      'package main\n\nimport (\n\t"github.com/acme/app/internal/store"\n\t_ "embed"\n)\n',
    );
    const paths = [
      'internal/store/store.go',
      'store/open.go',
      'internal/store/sql/sql.go',
      'internal/mystore/store.go',
      'embed/embed.go',
    ];

    expect(imported('Open', from, paths)).toEqual(['internal/store/store.go', 'store/open.go']);
    // Unexported names aren't used outside their package, and a blank import brings none.
    expect(imported('open', from, paths)).toEqual([]);
    expect(imported('FS', from, ['embed/embed.go'])).toEqual([]);
  });

  test('Java and Kotlin: imports, static imports, wildcards and the file’s own package', async () => {
    const java = await asking(
      'src/main/java/com/acme/app/Main.java',
      [
        'package com.acme.app;',
        'import com.acme.shapes.Circle;',
        'import com.acme.util.*;',
        'import static com.acme.math.Ops.square;',
      ].join('\n'),
    );
    const paths = [
      'src/main/java/com/acme/shapes/Circle.java',
      'src/main/kotlin/com/acme/shapes/Circle.kt',
      'src/main/java/com/acme/shapes/Square.java',
      'src/main/java/com/acme/util/Strings.java',
      'src/main/java/com/acme/math/Ops.java',
      'src/test/java/com/acme/app/Fixtures.java',
    ];

    // The class's files, and every file of the wildcard's package and of the file's own, in
    // another source folder.
    const anywhere = [
      'src/main/java/com/acme/util/Strings.java',
      'src/test/java/com/acme/app/Fixtures.java',
    ];
    expect(imported('Circle', java, paths)).toEqual(
      [
        'src/main/java/com/acme/shapes/Circle.java',
        'src/main/kotlin/com/acme/shapes/Circle.kt',
        ...anywhere,
      ].toSorted(),
    );
    expect(imported('square', java, paths)).toEqual(
      [
        'src/main/java/com/acme/math/Ops.java',
        // A class imported by name, whose members the file can use, as `Circle.unit()`.
        'src/main/java/com/acme/shapes/Circle.java',
        'src/main/kotlin/com/acme/shapes/Circle.kt',
        ...anywhere,
      ].toSorted(),
    );
    expect(imported('Square', java, ['src/main/java/com/acme/shapes/Square.java'])).toEqual([]);

    const kotlin = await asking(
      'app/src/Main.kt',
      'package com.acme.app\n\nimport com.acme.shapes.circleOf as circle\n',
    );
    expect(
      imported('circleOf', kotlin, ['lib/com/acme/shapes/Builders.kt', 'lib/com/acme/Other.kt']),
    ).toEqual(['lib/com/acme/shapes/Builders.kt']);
  });

  test('PHP: `use` as PSR-4 lays classes out, and the file’s own namespace', async () => {
    const from = await asking(
      'app/Http/Controllers/UserController.php',
      [
        '<?php',
        'namespace App\\Http\\Controllers;',
        'use App\\Models\\User;',
        'use App\\Models\\{Post, Comment as Reply};',
        'use function App\\Support\\clamp;',
      ].join('\n'),
    );
    const paths = [
      'app/Models/User.php',
      'src/Models/User.php',
      'app/User.php',
      'app/Models/Comment.php',
      'app/Support/helpers.php',
    ];

    // The classes imported, whose members the file uses through them, under any folder for the
    // namespace's first part.
    const classes = ['app/Models/Comment.php', 'app/Models/User.php', 'src/Models/User.php'];
    expect(imported('User', from, paths)).toEqual(classes);
    expect(imported('Reply', from, paths)).toEqual(classes);
    expect(imported('User', from, ['app/User.php', 'app/Http/User.php'])).toEqual([]);
    // A function can be in any file of its namespace's folder.
    expect(imported('clamp', from, paths)).toEqual([
      'app/Models/Comment.php',
      'app/Models/User.php',
      'app/Support/helpers.php',
      'src/Models/User.php',
    ]);
    // The file's own namespace links the files of its folder.
    expect(rank('Controller', from, [{ path: 'app/Http/Controllers/Controller.php' }])).toEqual([
      {
        candidate: { path: 'app/Http/Controllers/Controller.php' },
        near: 'folder',
        label: syntaxLabel,
      },
    ]);
  });

  test('the other languages rank without an import step', async () => {
    const from = await asking('lib/app.rb', "require_relative 'shapes/circle'\n");

    expect(ranked('Circle', from, ['lib/shapes/circle.rb'])).toEqual(['lib/shapes/circle.rb name']);
  });
});

describe('ranking a large tree', () => {
  /** A thousand names, as a file importing a module's every name by name might list. */
  const thousand = Array.from({ length: 1000 }, (_name, index) => ({ name: `name${index}` }));

  test.each([
    ['Python', 'app/main.py', (at: number) => `pkg${at}.sub`, thousand, 'src/pkg5/sub/name7.py'],
    [
      'Java',
      'app/Main.java',
      (at: number) => `com.acme.pkg${at}`,
      thousand,
      'src/com/acme/pkg5/name7.java',
    ],
    ['PHP', 'app/Main.php', (at: number) => `App\\Pkg${at}`, thousand, 'src/Pkg5/name7.php'],
    ['Go', 'app/main.go', (at: number) => `github.com/acme/pkg${at}`, 'all', 'acme/pkg5/shapes.go'],
  ] as const)(
    '%s: looks each candidate up in the imports, not each import at each candidate',
    (_language, path, module, names, match) => {
      // 90 imports, each of a thousand names, and 20,000 candidates the imports don't name.
      const from: Asking = {
        path,
        imports: Array.from({ length: 90 }, (_import, at): Import => ({
          line: at + 1,
          module: module(at),
          names,
        })),
      };
      const extension = match.slice(match.lastIndexOf('.'));
      const candidates = [
        ...Array.from({ length: 20_000 }, (_candidate, at) => ({
          path: `lib/pkg${at % 100}/sub/file${at}${extension}`,
        })),
        { path: match },
      ];
      const started = performance.now();

      const result = rank('Name', from, candidates);

      expect(performance.now() - started).toBeLessThan(1000);
      expect(
        result.filter(({ near }) => near === 'import').map(({ candidate }) => candidate.path),
      ).toEqual([match]);
    },
  );
});

describe('importOf', () => {
  test('finds the import that brings a name in by the name the file uses', async () => {
    const { imports } = await asking(
      'src/a.ts',
      "import * as path from 'node:path';\nimport { z as schema, ZodError } from 'zod';\n",
    );

    expect(importOf(imports, 'schema')).toEqual({ from: imports[1], name: 'z' });
    expect(importOf(imports, 'ZodError')).toEqual({ from: imports[1], name: 'ZodError' });
    expect(importOf(imports, 'z')).toBeUndefined();
    // A module brought in whole names nothing.
    expect(importOf(imports, 'join')).toBeUndefined();
  });
});

describe('join', () => {
  test('follows dots, and stops at the root', () => {
    expect(join('src/a', '../b/c')).toBe('src/b/c');
    expect(join('src', './x')).toBe('src/x');
    expect(join('', 'x')).toBe('x');
    expect(join('src', '../../x')).toBeUndefined();
  });
});
