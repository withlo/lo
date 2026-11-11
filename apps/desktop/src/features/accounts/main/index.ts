// The accounts feature in main: GitHub, as the accounts Lo is signed in to, for the other features
// (`service.ts`), and the accounts' summaries for the window. Tokens are kept encrypted by the
// system's keychain, and never leave main.

import { fileURLToPath } from 'node:url';

import { app, net, safeStorage } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { githubSettings, type GithubSettings } from '../../../main/environment.ts';
import { defineFeature, STOP_LIMITS } from '../../../main/features.ts';
import { netFetch } from '../../../main/fetch.ts';
import { provides } from '../../../main/services.ts';
import { accountSummary, contract, type AccountSummary } from '../contract.ts';
import { github } from '../service.ts';
import { buildOf } from './build.ts';
import { Github } from './github.ts';
import { Grants } from './grants.ts';

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

/** Which GitHub Lo talks to, and the account a test starts with. */
let settings: GithubSettings | undefined;
let running: Github | undefined;

function service(): Github {
  if (!running) throw new Error("The accounts feature hasn't provided GitHub yet.");
  return running;
}

/** Every account as the window sees it, checked against the contract. */
async function summaries(): Promise<AccountSummary[]> {
  const states = await service().accounts();
  return states.map(({ account, signedOut, cantSave }) =>
    accountSummary.parse({
      login: account.login,
      name: account.name ?? null,
      source: account.source,
      signedOut: signedOut ?? null,
      cantSave,
    }),
  );
}

export default defineFeature(contract, {
  provide({ database }) {
    settings = githubSettings({ packaged: app.isPackaged, env: process.env });
    const secrets = new Grants({
      database,
      storage: safeStorage,
      keychain: {
        platform: process.platform,
        testRun: settings.testRun,
        mockKeychain: app.commandLine.hasSwitch('use-mock-keychain'),
      },
      github: settings.urls.api,
    });
    running = new Github({
      database,
      secrets,
      fetch,
      urls: settings.urls,
      build: thisBuild(),
      log,
    });
    return [provides(github, running)];
  },
  handlers: {
    list: () => summaries(),
    async remove({ login }) {
      const accounts = await service().accounts();
      if (!accounts.some(({ account }) => account.login.toLowerCase() === login.toLowerCase())) {
        throw new IpcError('missing', `Lo isn't signed in to ${login}.`);
      }
      try {
        await service().remove(login);
      } catch (error) {
        log(`removing ${login}: ${String(error)}`);
        throw new IpcError('failed', `Lo couldn't remove ${login} completely.`);
      }
    },
  },
  start({ publish }) {
    const accounts = service();
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
    const tokenFile = settings?.tokenFile;
    if (tokenFile !== undefined) {
      accounts
        .addFromFile(tokenFile)
        .catch((error: unknown) =>
          log(`Lo couldn't add the account in LO_TEST_TOKEN_FILE: ${String(error)}`),
        );
    }
  },
  stop: () => service().stop(SAVE_WITHIN),
});
