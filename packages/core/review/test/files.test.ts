/** Review order, path order and initial states for whole pull requests, as GitHub would list them. */

import { expect, test } from 'vitest';

import {
  initialState,
  pathOrder,
  reviewOrder,
  startsCollapsed,
  type ChangedFile,
  type InitialState,
} from '../src/files.ts';

function file(path: string, additions: number, deletions: number): ChangedFile {
  return { path, additions, deletions, binary: false };
}

function markedGenerated(changed: ChangedFile): ChangedFile {
  return { ...changed, linguistGenerated: true };
}

function renamed(from: string, changed: ChangedFile): ChangedFile {
  return { ...changed, previousPath: from };
}

function binary(path: string): ChangedFile {
  return { ...file(path, 0, 0), binary: true };
}

/** The paths in `order`, checking it lists every file exactly once. */
function paths(files: readonly ChangedFile[], order: readonly number[]): (string | undefined)[] {
  expect(order.toSorted((a, b) => a - b)).toEqual(files.map((_, index) => index));
  return order.map((index) => files[index]?.path);
}

/** The files that start collapsed, with their states, in path order. */
function collapsed(files: readonly ChangedFile[]): [string, InitialState][] {
  return pathOrder(files).flatMap((index) => {
    const changed = files[index];
    if (changed === undefined) return [];
    const state = initialState(changed);
    return startsCollapsed(state) ? [[changed.path, state] as [string, InitialState]] : [];
  });
}

test('a typescript monorepo pull request', () => {
  const files = [
    file('pnpm-lock.yaml', 4_210, 3_980),
    file('apps/web/src/components/Button.test.tsx', 64, 0),
    file('apps/web/src/components/Button.tsx', 41, 12),
    file('.github/workflows/ci.yml', 6, 2),
    file('apps/api/test/index.test.ts', 22, 3),
    file('apps/api/src/index.ts', 18, 4),
    file('apps/web/src/index.ts', 2, 1),
    markedGenerated(file('apps/web/src/api/generated/schema.ts', 380, 120)),
    file('apps/web/src/api/client.ts', 33, 9),
    file('apps/web/src/api/client.spec.ts', 50, 2),
    file('apps/web/src/legacy/old.test.ts', 0, 88),
    file('apps/web/package.json', 3, 1),
    binary('apps/web/public/logo.png'),
    file('tsconfig.base.json', 1, 1),
    file('.gitattributes', 1, 0),
    file('README.md', 10, 2),
  ];

  expect(paths(files, reviewOrder(files))).toEqual([
    'README.md',
    'apps/api/src/index.ts',
    'apps/api/test/index.test.ts',
    'apps/web/public/logo.png',
    'apps/web/src/api/client.ts',
    'apps/web/src/api/client.spec.ts',
    'apps/web/src/components/Button.tsx',
    'apps/web/src/components/Button.test.tsx',
    'apps/web/src/index.ts',
    'apps/web/src/legacy/old.test.ts',
    '.gitattributes',
    '.github/workflows/ci.yml',
    'apps/web/package.json',
    'tsconfig.base.json',
    'apps/web/src/api/generated/schema.ts',
    'pnpm-lock.yaml',
  ]);
  expect(collapsed(files)).toStrictEqual([
    [
      'apps/web/src/api/generated/schema.ts',
      { generated: 'attribute', large: false, binary: false },
    ],
    ['pnpm-lock.yaml', { generated: 'lockfile', large: true, binary: false }],
  ]);
  const logo = files.find((changed) => changed.path === 'apps/web/public/logo.png');
  expect(logo && initialState(logo).binary).toBe(true);
});

test('a go service pull request', () => {
  const files = [
    file('go.sum', 40, 12),
    file('go.mod', 3, 1),
    file('cmd/server/main.go', 12, 3),
    file('internal/store/store_test.go', 140, 20),
    file('internal/store/store.go', 95, 30),
    file('internal/store/migrations.go', 24, 0),
    file('internal/store/export_test.go', 8, 8),
    file('internal/store/queries.sql', 30, 2),
    markedGenerated(file('internal/store/queries.sql.go', 210, 14)),
    file('internal/store/testdata/fixture.json', 60, 0),
    file('.golangci.yml', 2, 0),
  ];

  expect(paths(files, reviewOrder(files))).toEqual([
    'cmd/server/main.go',
    'go.mod',
    'internal/store/migrations.go',
    'internal/store/queries.sql',
    'internal/store/store.go',
    'internal/store/store_test.go',
    'internal/store/export_test.go',
    '.golangci.yml',
    'internal/store/testdata/fixture.json',
    'go.sum',
    'internal/store/queries.sql.go',
  ]);
  expect(paths(files, pathOrder(files))).toEqual([
    '.golangci.yml',
    'cmd/server/main.go',
    'go.mod',
    'go.sum',
    'internal/store/export_test.go',
    'internal/store/migrations.go',
    'internal/store/queries.sql',
    'internal/store/queries.sql.go',
    'internal/store/store.go',
    'internal/store/store_test.go',
    'internal/store/testdata/fixture.json',
  ]);
});

function cargoWorkspacePullRequest(): ChangedFile[] {
  return [
    file('Cargo.lock', 18, 2),
    file('Cargo.toml', 1, 0),
    file('core/parser/Cargo.toml', 7, 0),
    file('core/parser/src/lib.rs', 6, 0),
    file('core/parser/src/grammar/lexer.rs', 412, 0),
    file('core/parser/tests/lexer.rs', 260, 0),
    file('core/parser/tests/common/mod.rs', 40, 0),
    file('docs/plan.md', 4, 1),
    file('.github/workflows/ci.yml', 3, 3),
  ];
}

test('a rust workspace pull request', () => {
  const files = cargoWorkspacePullRequest();

  expect(paths(files, reviewOrder(files))).toEqual([
    'core/parser/src/grammar/lexer.rs',
    'core/parser/tests/lexer.rs',
    'core/parser/src/lib.rs',
    'docs/plan.md',
    'core/parser/tests/common/mod.rs',
    '.github/workflows/ci.yml',
    'Cargo.toml',
    'core/parser/Cargo.toml',
    'Cargo.lock',
  ]);
  expect(paths(files, pathOrder(files))).toEqual([
    '.github/workflows/ci.yml',
    'Cargo.lock',
    'Cargo.toml',
    'core/parser/Cargo.toml',
    'core/parser/src/grammar/lexer.rs',
    'core/parser/src/lib.rs',
    'core/parser/tests/common/mod.rs',
    'core/parser/tests/lexer.rs',
    'docs/plan.md',
  ]);
  expect(collapsed(files)).toStrictEqual([
    ['Cargo.lock', { generated: 'lockfile', large: false, binary: false }],
  ]);
});

test('a repository that unmarks its lockfile reviews it with config', () => {
  const [lockfile, ...rest] = cargoWorkspacePullRequest();
  const files = [...(lockfile ? [{ ...lockfile, linguistGenerated: false }] : []), ...rest];

  expect(paths(files, reviewOrder(files)).slice(5)).toEqual([
    '.github/workflows/ci.yml',
    'Cargo.lock',
    'Cargo.toml',
    'core/parser/Cargo.toml',
  ]);
  expect(collapsed(files)).toEqual([]);
});

test('a python pull request with renames and a large lockfile', () => {
  const files = [
    renamed('src/srcs/billing/bill.py', file('src/srcs/billing/invoice.py', 20, 6)),
    renamed('tests/billing/test_bill.py', file('tests/billing/test_invoice.py', 4, 4)),
    file('src/srcs/billing/tax.py', 31, 8),
    file('src/srcs/billing/tax_test.py', 45, 0),
    file('tests/billing/test_refunds.py', 70, 0),
    file('tests/conftest.py', 12, 0),
    file('src/srcs/billing/rates.proto', 9, 0),
    markedGenerated(file('src/srcs/billing/rates_pb2.py', 140, 0)),
    file('pyproject.toml', 2, 1),
    file('uv.lock', 3_900, 2_300),
  ];

  expect(paths(files, reviewOrder(files))).toEqual([
    'src/srcs/billing/invoice.py',
    'tests/billing/test_invoice.py',
    'src/srcs/billing/rates.proto',
    'src/srcs/billing/tax.py',
    'src/srcs/billing/tax_test.py',
    'tests/conftest.py',
    'tests/billing/test_refunds.py',
    'pyproject.toml',
    'src/srcs/billing/rates_pb2.py',
    'uv.lock',
  ]);
  expect(collapsed(files).map(([path, state]) => [path, state.generated, state.large])).toEqual([
    ['src/srcs/billing/rates_pb2.py', 'attribute', false],
    ['uv.lock', 'lockfile', true],
  ]);
});

test('a large hand written file starts collapsed but keeps its place', () => {
  const files = [
    file('src/parser.rs', 4_000, 1_500),
    file('src/lexer.rs', 120, 40),
    file('tests/parser.rs', 300, 10),
  ];

  expect(paths(files, reviewOrder(files))).toEqual([
    'src/lexer.rs',
    'src/parser.rs',
    'tests/parser.rs',
  ]);
  expect(collapsed(files)).toStrictEqual([
    ['src/parser.rs', { generated: undefined, large: true, binary: false }],
  ]);
});
