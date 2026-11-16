/**
 * Go: gopls, the Go team's language server. Lo builds it from its modules with its own Go, once,
 * offline, as the manifest pins them, and refuses a build whose hash isn't the one pinned
 * (`src/build.ts`), rather than downloading a binary: the Go team publishes none. It runs with Lo's
 * Go, `toolchainUse('go')`, first on its `PATH`.
 *
 * gopls loads a checkout's packages by running `go` (`go env`, `go list`, `go version`), and what
 * a checkout can say to `go` is held by Lo's variables:
 *
 * - a `toolchain` line, in a `go.mod` or a `go.work`, asks for nothing: `GOTOOLCHAIN=local` keeps
 *   Lo's Go, and a `go` line newer than it fails to load rather than fetch one;
 * - a dependency that isn't in the checkout isn't fetched (`GOPROXY=off`), so a symbol from it
 *   shows only its import, and nothing names a host Go would reach;
 * - nothing adds a flag to `go` (an empty `GOFLAGS`, and no settings file, `GOENV=off`), so no
 *   `-toolexec` program or `-overlay` runs or reads in its place, and nothing names a package
 *   driver, a program Go's package loader would run instead of `go list`: `GOPACKAGESDRIVER=off`,
 *   which also keeps it from running a `gopackagesdriver` it finds on `PATH`;
 * - cgo is off (`CGO_ENABLED=0`), so a file that imports `"C"` is left out and no C compiler or
 *   `pkg-config` runs, whatever its `#cgo` lines say;
 * - a `//go:generate` line runs only under `go generate`, which gopls runs only for a command Lo
 *   never sends, as it does `go mod tidy`, `go get`, vulncheck and opening a browser;
 * - a module's `tool` lines run only under `go tool`, which nothing runs, and `vendor/` is source
 *   gopls reads, as it reads the rest;
 * - a `go.work` in a folder above the checkout, or one in it that names a folder outside it,
 *   keeps the server from starting (`checkoutProblem`);
 * - a `.vscode/settings.json` isn't read: gopls's settings are what Lo answers to
 *   `workspace/configuration`, and its `build.env` and `build.buildFlags` aren't among them.
 *
 * gopls uses no network. Lo turns vulncheck off, which would otherwise offer to fetch Go's
 * vulnerability database, and its telemetry stays on this machine: gopls uploads only once someone
 * turns it on in its home, which is Lo's and in which no one does, and Lo refuses its request to
 * ask. It keeps its counters there, and runs a second copy of itself, in a session of its own, to
 * watch for its own crashes, which its family takes in. It runs no MCP server unless started with
 * a flag Lo doesn't give.
 *
 * Its caches are Go's, `GOMODCACHE` and `GOCACHE`, and its own, in its home. Like every server Lo
 * runs, it has no sandbox: it reads what the user can, so a `go.mod`'s `replace` with a path
 * outside the checkout leads it to files there, whose text a hover can show. Lo never opens a place
 * outside the checkout an answer names: it shows as outside the repository.
 */

import { LIMITS } from '../server.ts';
import { goMemoryLimit, type NativeServer } from './native.ts';

/** The inlay hints `gh` shows: the types Go leaves out, as vtsls shows TypeScript's. */
const HINTS = {
  assignVariableTypes: true,
  rangeVariableTypes: true,
  compositeLiteralTypes: true,
  functionTypeParameters: true,
};

export const GOPLS: NativeServer = {
  id: 'gopls',
  name: 'gopls',
  license: 'BSD-3-Clause',
  args: ['serve'],
  variables: { GOMEMLIMIT: goMemoryLimit(LIMITS.memoryCap) },
  settings: {
    gopls: {
      hints: HINTS,
      vulncheck: 'Off',
      // Its hovers link to no website: Lo shows them as text to read.
      linksInHover: false,
      telemetryPrompt: false,
    },
  },
  hints: true,
};
