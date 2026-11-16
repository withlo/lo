/**
 * Terraform: terraform-ls, HashiCorp's language server, downloaded from releases.hashicorp.com as
 * the manifest pins it, checked when it was pinned against the `SHA256SUMS` HashiCorp signs. It's
 * a program of its own, and needs no toolchain.
 *
 * terraform-ls runs Terraform when it finds it: the program its `terraform.path` names, or else
 * the first `terraform` on its `PATH`, where the folder of Lo's git can be Homebrew's. With it,
 * it asks `terraform version`, and `terraform providers schema`, which runs each provider plugin a
 * checkout's `.terraform/` holds. Lo gives it `/dev/null` as Terraform ({@link NO_TERRAFORM}), a
 * device and not a program, which fails to run, so it never looks on `PATH` and runs nothing:
 *
 * - a provider's plugin in `.terraform/providers/`, with a lock file that takes it as installed,
 *   never runs, and neither does a `terraform` in the checkout or on `PATH`;
 * - `terraform validate`, `fmt` and `init` would run only on save, or for formatting or a command,
 *   none of which Lo asks for, and Lo turns validating on save off besides;
 * - a `.vscode/settings.json` isn't read: its settings are Lo's initialization options alone.
 *
 * Without Terraform, it reads providers' schemas from those it carries, for the providers in the
 * Terraform Registry's official and partner tiers as it was built, rather than the versions a
 * checkout pins, and nothing of a provider it doesn't carry. Definitions, references and the
 * outline, which come from the configuration itself, are whole, though it answers references only
 * at a declaration, such as a local's or a variable's, so at a use of one it finds none. It answers
 * no inlay hints (`hints: false`).
 *
 * It asks registry.terraform.io for the inputs and outputs of each module a configuration calls
 * from a registry, and no setting turns that off. Its proxy, as every server's, leads nowhere
 * (`NO_NETWORK` in `src/environment.ts`), so each of those requests fails at once, sending
 * nothing, and a module's inputs come only from its source when that's in the checkout. Like every
 * server Lo runs, it has no sandbox: a module whose source is a path outside the checkout leads it
 * to files there, whose text a hover can show, and Lo never opens a place outside the checkout an
 * answer names.
 */

import type { NativeServer } from './native.ts';

/** The Terraform terraform-ls is given: none it can run. */
export const NO_TERRAFORM = '/dev/null';

export const TERRAFORM_LS: NativeServer = {
  id: 'terraform-ls',
  name: 'terraform-ls',
  license: 'MPL-2.0',
  args: ['serve'],
  settings: {},
  initializationOptions: {
    terraform: { path: NO_TERRAFORM },
    experimentalFeatures: { validateOnSave: false, prefillRequiredFields: false },
    // A folder that isn't a module of its own, as a pull request's checkout often holds, isn't
    // worth a notice Lo would only log.
    ignoreSingleFileWarning: true,
  },
  hints: false,
};
