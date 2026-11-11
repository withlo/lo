import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultPlaces, type Places } from '@lo/git';
import { describe, expect, it } from 'vitest';

import { Gh, GhError, ghEnvironment, parseStatus, summarize } from './gh.ts';
import { fakeGh, GH_TOKEN_FOR_BOT } from './test/gh.ts';

/** No usual folders, so only what a test puts on `PATH` is found. */
const nowhere: Places = { folders: [], groups: defaultPlaces(process.platform).groups };

/** Lo's environment as a test gives it: the stand-in's folder on `PATH`, and a home of its own. */
function environment(folder: string, extra: Record<string, string> = {}) {
  return { PATH: `${folder}:/usr/bin:/bin`, HOME: folder, ...extra };
}

/** What the stand-in gh was asked, one line per run. */
function asked(folder: string): string[] {
  try {
    return readFileSync(join(folder, 'asked'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('finding gh', () => {
  it('looks on path then in the usual folders', async () => {
    const first = fakeGh();
    const second = fakeGh();
    const later = fakeGh();
    const gh = new Gh({
      env: { PATH: `relative:${first.folder}:${second.folder}` },
      platform: process.platform,
      places: { folders: [later.folder], groups: nowhere.groups },
    });
    expect(await gh.find()).toEqual({ kind: 'found', program: first.program });
    const usual = new Gh({
      env: { PATH: '/nowhere' },
      platform: process.platform,
      places: { folders: [later.folder], groups: nowhere.groups },
    });
    expect(await usual.find()).toEqual({ kind: 'found', program: later.program });
  });

  it('runs the gh a test names, and none at all for none', async () => {
    const { program } = fakeGh();
    const env = { PATH: '/nowhere' };
    const platform = process.platform;
    expect(await new Gh({ env, platform, program, places: nowhere }).find()).toEqual({
      kind: 'found',
      program,
    });
    const other = fakeGh();
    expect(
      await new Gh({ env: { PATH: other.folder }, platform, program: 'none' }).find(),
    ).toMatchObject({ kind: 'missing', message: "Lo can't find gh, GitHub's command-line tool." });
  });

  it('passes over a gh other users can change, and says so when it finds no other', async () => {
    const { folder } = fakeGh();
    const shared = join(folder, 'shared');
    mkdirSync(shared);
    writeFileSync(join(shared, 'gh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(shared, 'gh'), 0o755);
    chmodSync(shared, 0o777);
    const gh = new Gh({ env: { PATH: shared }, platform: process.platform, places: nowhere });
    expect(await gh.find()).toEqual({
      kind: 'missing',
      message: `Lo found gh at ${join(shared, 'gh')}, but other users can change ${shared}, so Lo won't run it.`,
    });
    // A gh the person named is held to the same rule.
    const named = new Gh({
      env: {},
      platform: process.platform,
      program: join(shared, 'gh'),
      places: nowhere,
    });
    expect((await named.find()).kind).toBe('missing');
    // A trusted one later on wins.
    const trusted = fakeGh();
    const both = new Gh({
      env: { PATH: `${shared}:${trusted.folder}` },
      platform: process.platform,
      places: nowhere,
    });
    expect(await both.find()).toEqual({ kind: 'found', program: trusted.program });
  });

  it('passes over a link to a gh other users can change', async () => {
    const { folder } = fakeGh();
    const shared = join(folder, 'shared');
    mkdirSync(shared);
    writeFileSync(join(shared, 'real-gh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(shared, 'real-gh'), 0o755);
    chmodSync(shared, 0o777);
    const links = join(folder, 'links');
    mkdirSync(links);
    symlinkSync(join(shared, 'real-gh'), join(links, 'gh'));
    const gh = new Gh({ env: { PATH: links }, platform: process.platform, places: nowhere });
    expect(await gh.find()).toMatchObject({ kind: 'missing' });
  });

  it("skips what isn't a program", async () => {
    const { folder } = fakeGh();
    const plain = join(folder, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'gh'), 'not a program');
    const gh = new Gh({ env: { PATH: plain }, platform: process.platform, places: nowhere });
    expect(await gh.find()).toMatchObject({ kind: 'missing' });
  });
});

describe('running gh', () => {
  it('gh runs in the home folder', async () => {
    const { folder, program } = fakeGh({ script: '#!/bin/sh\npwd > "$(dirname "$0")/where"\n' });
    const home = join(folder, 'home');
    mkdirSync(home);
    const gh = new Gh({
      env: { PATH: '/usr/bin:/bin', HOME: home },
      platform: process.platform,
      places: nowhere,
    });
    await gh.version(program);
    expect(readFileSync(join(folder, 'where'), 'utf8').trim()).toBe(home);
  });

  it('gh runs without environment tokens or prompts', () => {
    const env = ghEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/me',
      GH_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      GITHUB_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      GH_ENTERPRISE_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      GITHUB_ENTERPRISE_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      GH_HOST: 'example.com',
      GH_DEBUG: 'api',
      LO_GIT_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      NODE_OPTIONS: '--inspect',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
      GH_SPINNER_DISABLED: '1',
      GH_PAGER: 'cat',
      NO_COLOR: '1',
    });
  });

  it('says its version', async () => {
    const { folder, program } = fakeGh();
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    expect(await gh.version(program)).toBe('2.103.3');
  });

  it('a command that hangs is stopped', async () => {
    const { folder, program } = fakeGh({ script: '#!/bin/sh\nexec sleep 30\n' });
    const gh = new Gh({
      env: environment(folder),
      platform: process.platform,
      places: nowhere,
      timeout: 200,
    });
    const started = Date.now();
    await expect(gh.accounts(program)).rejects.toThrow(
      "gh didn't list its accounts within 0.2 s, so Lo stopped it.",
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops every gh running as Lo quits', async () => {
    const { folder, program } = fakeGh({ script: '#!/bin/sh\nexec sleep 30\n' });
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    const listing = gh.accounts(program);
    gh.stop();
    await expect(listing).rejects.toThrow('Lo is quitting.');
    await expect(gh.accounts(program)).rejects.toThrow('Lo is quitting.');
  });

  it('reads a token through a pipe', async () => {
    const { folder, program } = fakeGh();
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    const token = await gh.token(program, 'rozed-bot');
    expect(token.expose()).toBe(GH_TOKEN_FOR_BOT);
    // Never as an argument: the login goes in one, joined to its flag, so it can't be an option.
    expect(asked(folder)).toEqual(['auth token --hostname github.com --user=rozed-bot']);
  });

  it("shows gh's error for an unknown account", async () => {
    const { folder, program } = fakeGh();
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    await expect(gh.token(program, 'nobody')).rejects.toThrow(
      new GhError("gh couldn't read nobody's token: no oauth token found for github.com"),
    );
  });

  it('gh never sees tokens from Lo’s environment', async () => {
    // The stand-in fails when a token reaches it.
    const { folder, program } = fakeGh();
    const env = environment(folder, {
      GH_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
      GITHUB_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
    });
    const gh = new Gh({ env, platform: process.platform, places: nowhere });
    expect((await gh.accounts(program)).map(({ login }) => login)).toEqual([
      'rozed-bot',
      'someone-else',
      'broken',
    ]);
    expect((await gh.token(program, 'rozed-bot')).expose()).toBe(GH_TOKEN_FOR_BOT);
  });

  it('asks for a newer gh when it has no JSON', async () => {
    const { folder, program } = fakeGh({
      script: '#!/bin/sh\necho "unknown flag: --json" >&2\nexit 1\n',
    });
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    await expect(gh.accounts(program)).rejects.toThrow(
      'Lo needs a newer gh to list its accounts. Update gh and try again.',
    );
  });

  it('never repeats a token gh printed in an error', async () => {
    const { folder, program } = fakeGh({
      script: `#!/bin/sh\necho "bad token gho_FAKE_LEAKED and github_pat_FAKE_LEAKED" >&2\nexit 1\n`,
    });
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    const error: unknown = await gh.accounts(program).catch((thrown: unknown) => thrown);
    expect(String(error)).not.toContain('LEAKED');
    expect(String(error)).toContain('bad token <redacted> and <redacted>');
  });

  it("refuses a token that can't be one, without repeating it", async () => {
    const { folder, program } = fakeGh({
      script: '#!/bin/sh\nprintf "gho_FAKE\\nSECOND_LINE\\n"\n',
    });
    const gh = new Gh({ env: environment(folder), platform: process.platform, places: nowhere });
    const error: unknown = await gh.token(program, 'rozed-bot').catch((thrown: unknown) => thrown);
    expect(String(error)).not.toContain('SECOND_LINE');
    expect(String(error)).not.toContain('gho_FAKE');
  });
});

describe('gh’s accounts', () => {
  it('parses gh auth status', () => {
    // As gh 2.103.3 prints it, plus an account whose token is from GH_TOKEN, which gh reports as
    // an extra entry, and an enterprise host's.
    const accounts = parseStatus(`{"hosts":{"github.com":[
      {"state":"success","active":true,"host":"github.com","login":"rozed-bot","tokenSource":"/tmp/gh/hosts.yml","scopes":"delete_repo, read:org, repo, workflow","gitProtocol":"https"},
      {"state":"success","active":false,"host":"github.com","login":"other","tokenSource":"keyring","scopes":"gist, read:org, repo","gitProtocol":"https","refreshable":true,"tokenExpiresAt":"2026-11-06T17:00:00Z"},
      {"state":"error","active":false,"host":"github.com","login":"broken","tokenSource":"keyring","gitProtocol":"https"},
      {"state":"success","active":true,"host":"github.com","login":"from-env","tokenSource":"GH_TOKEN","scopes":"repo"},
      {"state":"success","active":false,"host":"github.com","login":"ROZED-BOT","tokenSource":"keyring"},
      {"state":"success","active":false,"host":"github.com","login":"--hostname","tokenSource":"keyring"},
      {"state":"success","active":false,"host":"github.com","login":42}
    ],"ghe.example.com":[{"state":"success","login":"enterprise","tokenSource":"keyring"}]}}`);
    expect(accounts).toEqual([
      {
        login: 'rozed-bot',
        active: true,
        state: 'success',
        scopes: ['delete_repo', 'read:org', 'repo', 'workflow'],
        refreshable: false,
      },
      {
        login: 'other',
        active: false,
        state: 'success',
        scopes: ['gist', 'read:org', 'repo'],
        refreshable: true,
      },
      { login: 'broken', active: false, state: 'error', scopes: [], refreshable: false },
    ]);
    expect(() => parseStatus('not json')).toThrow(GhError);
    expect(() => parseStatus('{"hosts":null}')).toThrow(GhError);
    expect(parseStatus('{"hosts":{}}')).toEqual([]);
  });

  it('keeps what gh said short, and the last thing it said', () => {
    expect(summarize('warning: something\n\nerror: the real reason\n\n')).toBe(
      'error: the real reason',
    );
    expect(summarize('')).toBe('');
    expect(Array.from(summarize('x'.repeat(1000))).length).toBe(300);
  });
});
