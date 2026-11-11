// The accounts feature in main: GitHub, as the accounts Lo is signed in to, for the other features
// (`service.ts`), and for the window the accounts' summaries, signing in with GitHub's device flow,
// importing accounts from `gh`, and remembering which account opens a repository. Tokens are kept
// encrypted by the system's keychain, and never leave main.

import { fileURLToPath } from 'node:url';

import { RepoRef, sameLogin } from '@lo/github';
import { app, clipboard, net, safeStorage } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { openPage } from '../../../main/browser.ts';
import { ghProgram, githubSettings, type GithubSettings } from '../../../main/environment.ts';
import { defineFeature, STOP_LIMITS } from '../../../main/features.ts';
import { netFetch } from '../../../main/fetch.ts';
import { provides } from '../../../main/services.ts';
import {
  accountSummary,
  contract,
  ghListing,
  imported,
  signInState,
  type AccountSummary,
} from '../contract.ts';
import { github } from '../service.ts';
import { buildOf } from './build.ts';
import { Gh } from './gh.ts';
import { Github } from './github.ts';
import { Grants } from './grants.ts';
import { importFromGh, listGh, rereadFromGh } from './importing.ts';
import { SignIns } from './signin.ts';

/**
 * How long saving before quitting waits for renewals GitHub is answering: within the feature's
 * own limit for stopping, so the database is still open for the last save.
 */
const SAVE_WITHIN = STOP_LIMITS.each - 1_000;

/**
 * Every request to GitHub goes through Chromium's network stack, with the system's proxy, keeping
 * nothing in Chromium's cache.
 */
const fetch = netFetch((options) => net.request(options));

/**
 * This build of Lo: a hash of the code main runs, which holds the pollers' reads and their shapes.
 * This module is bundled into main's entry, at the top of main's output folder.
 */
function thisBuild(): string {
  return buildOf(fileURLToPath(new URL('.', import.meta.url)));
}

const log = (message: string) => console.error(`accounts: ${message}`);

/** What the feature runs, once it has provided GitHub. */
interface Running {
  settings: GithubSettings;
  github: Github;
  grants: Grants;
  gh: Gh;
  signIns: SignIns;
}

let running: Running | undefined;

function feature(): Running {
  if (!running) throw new Error("The accounts feature hasn't provided GitHub yet.");
  return running;
}

/** Every account as the window sees it, checked against the contract. */
async function summaries(): Promise<AccountSummary[]> {
  const states = await feature().github.accounts();
  return states.map(({ account, signedOut, cantSave, needsKeyring }) =>
    accountSummary.parse({
      login: account.login,
      name: account.name ?? null,
      source: account.source,
      signedOut: signedOut ?? null,
      cantSave,
      needsKeyring,
    }),
  );
}

/** The logins of every account Lo has. */
async function logins(): Promise<string[]> {
  return (await feature().github.accounts()).map(({ account }) => account.login);
}

/**
 * The code sign-in `id` waits for, and the page to enter it on, which is always GitHub's own page
 * for entering codes, whatever GitHub's answer named.
 */
function waitingFor(id: number): { userCode: string; page: string } {
  const { signIns, settings } = feature();
  const waiting = signIns.waiting(id);
  if (waiting === undefined) {
    throw new IpcError('over', "This sign-in isn't waiting for its code any more.");
  }
  if (waiting.page !== `${settings.urls.web.replace(/\/+$/, '')}/login/device`) {
    throw new IpcError('refused', `Lo won't open ${waiting.page}.`);
  }
  return waiting;
}

export default defineFeature(contract, {
  provide({ database, publish }) {
    const settings = githubSettings({ packaged: app.isPackaged, env: process.env });
    const { urls } = settings;
    const grants = new Grants({
      database,
      storage: safeStorage,
      keychain: {
        platform: process.platform,
        testRun: settings.testRun,
        mockKeychain: app.commandLine.hasSwitch('use-mock-keychain'),
      },
      github: urls.api,
    });
    const gh = new Gh({
      env: process.env,
      platform: process.platform,
      program: ghProgram({
        packaged: app.isPackaged,
        env: process.env,
        testRun: settings.testRun,
      }),
    });
    const service = new Github({
      database,
      secrets: grants,
      fetch,
      urls,
      build: thisBuild(),
      log,
      reread: rereadFromGh({ gh, fetch, urls, log }),
    });
    const signIns = new SignIns({
      fetch,
      urls,
      keyring: () => grants.problem(),
      add: (user, grant) => service.add(user, grant, 'deviceFlow'),
      publish: (state) => publish('signingIn', state),
      log,
    });
    running = { settings, github: service, grants, gh, signIns };
    return [provides(github, service)];
  },
  handlers: {
    list: () => summaries(),
    async remove({ login }) {
      const accounts = await feature().github.accounts();
      if (!accounts.some(({ account }) => sameLogin(account.login, login))) {
        throw new IpcError('missing', `Lo isn't signed in to ${login}.`);
      }
      try {
        await feature().github.remove(login);
      } catch (error) {
        log(`removing ${login}: ${String(error)}`);
        throw new IpcError('failed', `Lo couldn't remove ${login} completely.`);
      }
    },
    async keyring() {
      return (await feature().grants.problem()) ?? null;
    },
    async signIn() {
      // Checked as a push is, so the window gets nothing but what the contract says.
      return signInState.parse(await feature().signIns.start());
    },
    cancelSignIn({ id }) {
      feature().signIns.cancel(id);
    },
    async copyCode({ id }) {
      await clipboard.writeText(waitingFor(id).userCode);
    },
    async openGithub({ id }) {
      const { userCode, page } = waitingFor(id);
      await clipboard.writeText(userCode);
      try {
        await openPage(page);
      } catch (error) {
        log(`opening GitHub's page: ${String(error)}`);
        throw new IpcError('unopened', `Lo couldn't open ${page}. Open it in your browser.`);
      }
    },
    async ghAccounts() {
      return ghListing.parse(await listGh(feature().gh, await logins(), log));
    },
    async importGh({ logins: chosen }) {
      const { grants, gh, settings, github: service } = feature();
      const problem = await grants.problem();
      if (problem !== undefined) throw new IpcError('noKeyring', problem);
      const results = await importFromGh(
        {
          gh,
          fetch,
          urls: settings.urls,
          add: (user, grant) => service.add(user, grant, 'gh'),
          log,
        },
        chosen,
      );
      return results.map((result) => imported.parse(result));
    },
    async choose({ owner, name, login, remember }) {
      const { github: service } = feature();
      const state = (await service.accounts()).find(({ account }) =>
        sameLogin(account.login, login),
      );
      if (state === undefined) throw new IpcError('missing', `Lo isn't signed in to ${login}.`);
      if (state.signedOut !== undefined) {
        throw new IpcError('signedOut', `${state.account.login} is signed out.`);
      }
      const chosen = state.account.login;
      if (remember === 'owner') await service.rememberAccountForOwner(owner, chosen);
      else await service.rememberAccountForRepo(new RepoRef(owner, name), chosen);
    },
  },
  start({ publish }) {
    const { github: accounts, grants, signIns, settings } = feature();
    accounts.onChange(() => {
      summaries().then(
        (list) => publish('accounts', list),
        (error: unknown) => log(`listing the accounts: ${String(error)}`),
      );
    });
    accounts.onEvent((event) => {
      if (event.kind !== 'seen') publish('event', event);
    });
    // Each poller polls faster while Lo's window is in front.
    accounts.setForeground(false);
    app.on('browser-window-focus', () => accounts.setForeground(true));
    app.on('browser-window-blur', () => accounts.setForeground(false));
    // A sign-in stops polling once the page that asked for it is gone or loads again.
    app.on('web-contents-created', (_event, contents) => {
      contents.once('destroyed', () => signIns.cancel());
      contents.on('did-start-navigation', ({ isSameDocument }) => {
        if (!isSameDocument) signIns.cancel();
      });
    });
    // Where no keyring answers, every account says so from the start. Only Linux's keyring can be
    // missing, and asking a Mac's keychain this early could prompt before the window is up.
    if (process.platform === 'linux') {
      accounts
        .checkKeyring(() => grants.problem())
        .catch((error: unknown) => log(`checking the keychain: ${String(error)}`));
    }
    const { tokenFile } = settings;
    if (tokenFile !== undefined) {
      accounts
        .addFromFile(tokenFile)
        .catch((error: unknown) =>
          log(`Lo couldn't add the account in LO_TEST_TOKEN_FILE: ${String(error)}`),
        );
    }
  },
  async stop() {
    const { signIns, gh, github: accounts } = feature();
    signIns.stop();
    // gh stops after the accounts, so a token being read from it again as Lo quits is still read.
    // One stopped past the accounts' limit counts as gh not answering, which signs nothing out.
    try {
      await accounts.stop(SAVE_WITHIN);
    } finally {
      gh.stop();
    }
  },
});
