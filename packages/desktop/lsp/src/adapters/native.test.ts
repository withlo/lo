// The servers that are programs of their own, as their adapters start them: what runs, with which
// arguments, toolchain and variables, what each is told, and what the manifest pins for it. No
// server runs here; `test/hostile.test.ts` starts each as Lo would, with the fake server standing
// in for it.

import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GIT } from '../../test/support.ts';
import { serverEnvironment } from '../environment.ts';
import type { Installed } from '../install.ts';
import { MANIFEST } from '../manifest.ts';
import { sectionOf } from '../requests.ts';
import { LIMITS } from '../server.ts';
import { toolchainUse } from '../toolchains.ts';
import { GOPLS } from './gopls.ts';
import { goMemoryLimit, launchNative, type NativeServer } from './native.ts';
import { NO_TERRAFORM, TERRAFORM_LS } from './terraform.ts';

const SERVERS = [GOPLS, TERRAFORM_LS];

/** `server`, installed as the manifest pins it. */
function installed(server: NativeServer): Installed {
  const folder = `/lo/cache/servers/${server.id}/${MANIFEST[server.id]?.version}/files`;
  return { folder, entry: `${folder}/${server.id === 'gopls' ? 'gopls' : 'terraform-ls'}` };
}

/** Lo's Go, installed as `toolchains.json` pins it. */
const GO_FILES = '/lo/cache/toolchains/go/1.27.4/files';
const GO = toolchainUse('go', '1.27.4', { folder: GO_FILES, entry: `${GO_FILES}/go/bin/go` });

test('each starts as its own program, by its absolute path, with nothing from the checkout', () => {
  for (const server of SERVERS) {
    const install = installed(server);
    const launch = launchNative(server, install);
    expect(launch.program).toBe(install.entry);
    expect(launch.args).toEqual(['serve']);
    // Nothing of its own goes into its environment without a toolchain.
    expect(launch.path).toBeUndefined();
  }
  expect(() => launchNative(GOPLS, { folder: 'gopls', entry: 'gopls/gopls' })).toThrow(
    'gopls/gopls isn’t an absolute path',
  );
  expect(() => launchNative({ ...GOPLS, id: 'go-langserver' }, installed(GOPLS))).toThrow(
    'has no go-langserver',
  );
});

test('each says what it is, with its version and license, wherever its details show', () => {
  expect(SERVERS.map((server) => launchNative(server, installed(server)).version)).toEqual([
    `gopls ${MANIFEST.gopls?.version} · BSD-3-Clause`,
    `terraform-ls ${MANIFEST['terraform-ls']?.version} · MPL-2.0`,
  ]);
  const readme = readFileSync(join(import.meta.dirname, '..', '..', 'README.md'), 'utf8');
  for (const server of SERVERS) {
    const row = new RegExp(
      `^\\| ${server.name}\\b[^|\\n]*\\| ${MANIFEST[server.id]?.version} +\\|[^\\n]*\\| ${server.license}\\b`,
      'm',
    );
    expect(readme).toMatch(row);
  }
});

describe('gopls', () => {
  const launch = launchNative(GOPLS, installed(GOPLS), [GO]);

  test('runs with Lo’s Go, first on its PATH, held to it by Go’s variables', () => {
    expect(launch.path).toEqual([`${GO_FILES}/go/bin`]);
    expect(launch.variables).toEqual({ ...GO.variables, GOMEMLIMIT: '3072MiB' });
    expect(launch.allowed).toEqual(['GOFLAGS', 'GOPACKAGESDRIVER']);
    expect(launch.homeFolders).toEqual(GO.homeFolders);
    const env = serverEnvironment({
      home: '/lo/cache/code/homes/a/b/gopls',
      roots: ['/lo/cache/checkouts/a/b/pull-1'],
      path: launch.path ?? [],
      variables: launch.variables,
      allowed: launch.allowed,
      homeFolders: launch.homeFolders,
      git: GIT,
    });
    expect(env).toMatchObject({
      GOROOT: `${GO_FILES}/go`,
      GOTOOLCHAIN: 'local',
      GOENV: 'off',
      GOPROXY: 'off',
      GOFLAGS: '',
      CGO_ENABLED: '0',
      GOPACKAGESDRIVER: 'off',
      GOPATH: '/lo/cache/code/homes/a/b/gopls/go',
      GOMODCACHE: '/lo/cache/code/homes/a/b/gopls/go/pkg/mod',
      GOCACHE: '/lo/cache/code/homes/a/b/gopls/cache/go-build',
    });
  });

  test('keeps its heap under Lo’s cap on its group, with room for the go commands it runs', () => {
    expect(goMemoryLimit(LIMITS.memoryCap)).toBe('3072MiB');
    expect(goMemoryLimit(1024 ** 3)).toBe('768MiB');
  });

  test('fetches nothing, links to nothing, and asks no one about telemetry', () => {
    expect(sectionOf(GOPLS.settings, 'gopls.vulncheck')).toBe('Off');
    expect(sectionOf(GOPLS.settings, 'gopls.linksInHover')).toBe(false);
    expect(sectionOf(GOPLS.settings, 'gopls.telemetryPrompt')).toBe(false);
    // Nothing that names the environment or the flags its `go` commands run with.
    expect(sectionOf(GOPLS.settings, 'gopls.build')).toBeNull();
    expect(GOPLS.initializationOptions).toBeUndefined();
  });

  test('gives the type hints gh shows', () => {
    expect(GOPLS.hints).toBe(true);
    expect(sectionOf(GOPLS.settings, 'gopls.hints.assignVariableTypes')).toBe(true);
    expect(sectionOf(GOPLS.settings, 'gopls.hints.rangeVariableTypes')).toBe(true);
  });
});

describe('terraform-ls', () => {
  const launch = launchNative(TERRAFORM_LS, installed(TERRAFORM_LS));

  test('is given no Terraform it can run, so it looks for none', () => {
    expect(launch.initializationOptions).toMatchObject({ terraform: { path: NO_TERRAFORM } });
    expect(NO_TERRAFORM).toBe('/dev/null');
    // A device, never a program: terraform-ls's attempt to run it fails, and it runs nothing else.
    expect(statSync(NO_TERRAFORM).isFile()).toBe(false);
    expect(() => accessSync(NO_TERRAFORM, constants.X_OK)).toThrow('EACCES');
  });

  test('validates nothing on save, and needs no toolchain or variable', () => {
    expect(launch.initializationOptions).toMatchObject({
      experimentalFeatures: { validateOnSave: false, prefillRequiredFields: false },
    });
    expect([launch.path, launch.variables, launch.allowed, launch.homeFolders]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(TERRAFORM_LS.hints).toBe(false);
  });
});
