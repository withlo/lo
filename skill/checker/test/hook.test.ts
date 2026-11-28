/**
 * The skill's hook, `hook.mjs`: which commands it answers, how it finds the pull request, the
 * switches that turn it off, and one writer per pull request, with its one follow-up. It's run as
 * Claude Code and Codex run it, too: as a script, given its input on standard input, with `gh` a
 * script of the test's own.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  actionsIn,
  answerFor,
  branchOf,
  commandsIn,
  CURRENT,
  failedOrIdle,
  giveBack,
  hook,
  keepLock,
  lastPullIn,
  LOCK_MS,
  lockFolder,
  offBy,
  personalSettings,
  pullOf,
  readJsonc,
  takeLock,
  textOf,
} from '@lo/skill/hook.mjs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { scratch } from './support.ts';

/** The hook, as Claude Code and Codex run it. */
const HOOK = fileURLToPath(import.meta.resolve('@lo/skill/hook.mjs'));

let root: ReturnType<typeof scratch>;
let made = 0;

beforeAll(() => {
  root = scratch('hook');
});

afterAll(() => root.remove());

/** A new empty folder in the test's own. */
function fresh(name = 'case'): string {
  const dir = join(root.dir, `${name}-${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** What `actionsIn` makes of `command` in `/work`, with each branch by name, `*` for the current. */
function pushed(command: string): string[] {
  return actionsIn(command, '/work').map((action) =>
    action.kind === 'create'
      ? `create in ${action.dir}`
      : `push ${action.branches.map((branch) => (branch === CURRENT ? '*' : branch)).join(',')} in ${action.dir}`,
  );
}

describe('the commands it answers', () => {
  test('splits a command as a shell does, quotes and all', () => {
    expect(commandsIn(`git commit -m "a && git push" && git push 'origin' 2>&1 | tail -3`)).toEqual(
      [
        ['git', 'commit', '-m', 'a && git push'],
        ['git', 'push', 'origin'],
        ['tail', '-3'],
      ],
    );
    expect(commandsIn('echo "$(git push)" `git push`; # git push\nls')).toEqual([
      ['echo', '$(git push)', '`git push`'],
      ['ls'],
    ]);
    expect(commandsIn('a\\\n b > out.txt; (cd x && y)')).toEqual([['a', 'b'], ['cd', 'x'], ['y']]);
  });

  test('takes in every push of a branch, wherever it runs', () => {
    expect(pushed('git push')).toEqual(['push * in /work']);
    expect(pushed('git push -u origin HEAD')).toEqual(['push * in /work']);
    expect(pushed('git push origin work +other refs/heads/a:refs/heads/b')).toEqual([
      'push work,other,b in /work',
    ]);
    expect(pushed('git push --force-with-lease origin @')).toEqual(['push * in /work']);
    expect(pushed('git push -o ci.skip origin work')).toEqual(['push work in /work']);
    // The repository, as `--repo` names it, and so the branch checked out.
    expect(pushed('git push --repo origin')).toEqual(['push * in /work']);
    expect(pushed('git push origin -- --odd')).toEqual(['push --odd in /work']);
    expect(pushed('git push --all origin')).toEqual(['push * in /work']);
    expect(pushed('git -C sub -c push.default=current --no-pager push')).toEqual([
      'push * in /work/sub',
    ]);
    expect(pushed('cd /elsewhere && GIT_TRACE=1 env -i git push && cd .. && git push')).toEqual([
      'push * in /elsewhere',
      'push * in /',
    ]);
    expect(pushed('/usr/bin/git push')).toEqual(['push * in /work']);
  });

  test('takes in opening a pull request, but not a dry run or one in the browser', () => {
    expect(pushed('gh pr create --fill')).toEqual(['create in /work']);
    expect(pushed('git push -u origin work && gh pr new --draft')).toEqual([
      'push work in /work',
      'create in /work',
    ]);
    expect(pushed('gh pr create --dry-run')).toEqual([]);
    expect(pushed('gh pr create --web')).toEqual([]);
    expect(pushed('gh pr view 5')).toEqual([]);
  });

  test('leaves out a push of the overview’s own refs, a dry run, a deletion, and tags', () => {
    // The writer's own push, which would otherwise start another writer for ever.
    expect(pushed("git push 'https://github.com/o/r.git' 'abc:refs/lo/pr/5'")).toEqual([]);
    expect(pushed('git push origin HEAD:refs/lo/stack/3 HEAD:refs/lo/terms')).toEqual([]);
    expect(pushed('git push origin HEAD:refs/lo/pr/5 work')).toEqual(['push work in /work']);
    for (const command of [
      'git push --dry-run',
      'git push -nu origin work',
      'git push --delete origin work',
      'git push -d origin work',
      'git push origin :work',
      'git push origin ^work',
      'git push --tags',
      'git push origin refs/tags/v1',
      'echo git push',
      "echo 'git push'",
      'git pushx',
      'git log --grep push',
    ]) {
      expect({ command, actions: pushed(command) }).toEqual({ command, actions: [] });
    }
  });

  test('reads each refspec for the branch it pushes to', () => {
    expect(branchOf('work')).toBe('work');
    expect(branchOf('+a:b')).toBe('b');
    expect(branchOf('HEAD')).toBe(CURRENT);
    expect(branchOf('HEAD:refs/heads/x')).toBe('x');
    expect(branchOf(':')).toBe(CURRENT);
    expect(branchOf(':gone')).toBeUndefined();
    expect(branchOf('a:refs/lo/pr/1')).toBeUndefined();
    expect(branchOf('a:refs/pull/1/head')).toBeUndefined();
  });
});

describe('what the call printed', () => {
  test('is text, as Claude Code, Codex and MCP tools give it', () => {
    expect(textOf({ stdout: 'out', stderr: 'err', interrupted: false })).toBe('out\nerr');
    expect(textOf('Exit code: 0\nOutput:\nhi')).toBe('Exit code: 0\nOutput:\nhi');
    expect(textOf([{ type: 'text', text: 'x' }])).toBe('[{"type":"text","text":"x"}]');
    expect(textOf(undefined)).toBe('');
  });

  test('says when a push failed, was refused or changed nothing', () => {
    expect(failedOrIdle('To ../r.git\n   a..b  work -> work')).toBe(false);
    expect(failedOrIdle('Everything up-to-date\n')).toBe(true);
    expect(
      failedOrIdle('Exit code: 0\nWall time: 0.2 seconds\nOutput:\nEverything up-to-date'),
    ).toBe(true);
    expect(failedOrIdle('Exit code: 1\nOutput:\nfatal: no upstream')).toBe(true);
    expect(failedOrIdle('Process exited with code 128')).toBe(true);
    expect(failedOrIdle(' ! [rejected]        work -> work (fetch first)')).toBe(true);
    expect(failedOrIdle('error: failed to push some refs')).toBe(true);
  });

  test('takes a pull request’s link only as GitHub writes it', () => {
    expect(pullOf('https://github.com/withlo/lo/pull/12')).toEqual({
      owner: 'withlo',
      repo: 'lo',
      number: 12,
      url: 'https://github.com/withlo/lo/pull/12',
    });
    for (const link of [
      'https://github.com/withlo/lo/pull/12/files',
      'https://github.com/withlo/lo/pull/0',
      'https://github.com/-x/lo/pull/1',
      'https://github.com/x/../pull/1',
      'http://github.com/withlo/lo/pull/1',
      'https://github.com.evil/withlo/lo/pull/1',
      ' https://github.com/withlo/lo/pull/1',
      'https://github.com/withlo/lo/pull/1\nmore',
    ]) {
      expect({ link, pull: pullOf(link) }).toEqual({ link, pull: undefined });
    }
    expect(lastPullIn('Warning: 1 change\nhttps://github.com/a/b/pull/3\n')?.number).toBe(3);
    expect(lastPullIn('https://github.com/a/b/pull/new/work')).toBeUndefined();
  });
});

describe('the switches', () => {
  test('read Lo’s settings files, comments and all', () => {
    expect(readJsonc('// x\n{ "a": 1, /* y */ "b": [1, 2,], }\n')).toEqual({ a: 1, b: [1, 2] });
    expect(readJsonc('﻿{ "s": "// not a comment, /* nor this */", }')).toEqual({
      s: '// not a comment, /* nor this */',
    });
    expect(readJsonc('{ "a": 1 /* open')).toBeUndefined();
    expect(readJsonc('{ "a": }')).toBeUndefined();
  });

  test('turn it off when either file says false, and nothing else does', () => {
    const top = fresh('switches');
    const home = fresh('home');
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'xdg') };
    const repo = join(top, '.lo', 'settings.json');
    const person = personalSettings(env);
    expect(person).toBe(
      platform() === 'darwin'
        ? join(home, '.config', 'lo', 'settings.json')
        : join(home, 'xdg', 'lo', 'settings.json'),
    );
    mkdirSync(join(top, '.lo'));
    mkdirSync(join(person, '..'), { recursive: true });
    expect(offBy(top, env)).toBeUndefined();
    for (const text of [
      '{ "overview.auto": "false" }',
      '{ "overview.auto": true }',
      'not JSON',
      '[]',
    ]) {
      writeFileSync(repo, text);
      expect({ text, off: offBy(top, env) }).toEqual({ text, off: undefined });
    }
    writeFileSync(repo, '// The team\'s.\n{\n  "overview.auto": false, // Off for now.\n}\n');
    expect(offBy(top, env)).toBe('repository');
    // The last of a key given twice is the one, as for Lo.
    writeFileSync(repo, '{ "overview.auto": false, "overview.auto": true }');
    expect(offBy(top, env)).toBeUndefined();
    writeFileSync(person, '{ "overview.auto": false }');
    expect(offBy(top, env)).toBe('person');
    expect(offBy(undefined, env)).toBe('person');
    // A file too large, or a pipe, is read as saying nothing, and never waited on.
    writeFileSync(person, `{ "overview.auto": false, "x": "${'x'.repeat(1024 * 1024)}" }`);
    expect(offBy(top, env)).toBeUndefined();
    writeFileSync(repo, '{}');
    const pipe = join(fresh('pipe'), '.lo');
    mkdirSync(pipe);
    expect(spawnSync('mkfifo', [join(pipe, 'settings.json')]).status).toBe(0);
    expect(offBy(join(pipe, '..'), env)).toBeUndefined();
  });
});

describe('one writer per pull request', () => {
  const pull = pullOf('https://github.com/Acme/Demo/pull/7')!;

  test('takes the lock, holds it with one follow-up, and gives it back', () => {
    const env = { TMPDIR: fresh('locks') };
    expect(takeLock(pull, { env, call: 'a' })).toBe('taken');
    // The same call again, as one that pushes and opens a pull request runs the hook twice.
    expect(takeLock(pull, { env, call: 'a' })).toBe('same');
    expect(takeLock(pull, { env, call: 'b' })).toBe('held');
    expect(takeLock(pull, { env, call: 'c' })).toBe('held');
    // Case is the same pull request on GitHub.
    expect(takeLock(pullOf('https://github.com/acme/demo/pull/7')!, { env })).toBe('held');
    // One follow-up, however many pushes came.
    expect(giveBack(pull, { env })).toBe('again');
    expect(takeLock(pull, { env, call: 'd' })).toBe('held');
    expect(giveBack(pull, { env })).toBe('again');
    expect(giveBack(pull, { env })).toBe('done');
    expect(takeLock(pull, { env, call: 'e' })).toBe('taken');
    // Another pull request has a lock of its own.
    expect(takeLock(pullOf('https://github.com/acme/demo/pull/8')!, { env })).toBe('taken');
  });

  test('lapses a lock no writer kept within its time, follow-up and all', () => {
    const env = { TMPDIR: fresh('lapse') };
    expect(takeLock(pull, { env })).toBe('taken');
    expect(takeLock(pull, { env })).toBe('held');
    const later = Date.now() + LOCK_MS + 1000;
    expect(takeLock(pull, { env, now: later })).toBe('taken');
    // The follow-up went with it.
    expect(giveBack(pull, { env })).toBe('done');
    // A writer that starts keeps it, as one does.
    expect(keepLock(pull, { env })).toBe('kept');
    expect(takeLock(pull, { env })).toBe('held');
  });

  test('keeps locks only in a folder of the person’s own', () => {
    const base = fresh('shared');
    const env = { TMPDIR: base };
    const folder = lockFolder(env)!;
    expect(folder).toBe(join(base, `lo-overview-${process.getuid?.() ?? ''}`));
    chmodSync(folder, 0o777);
    expect(lockFolder(env)).toBeUndefined();
    expect(takeLock(pull, { env })).toBe('unlocked');
    expect(keepLock(pull, { env })).toBe('unlocked');
    expect(giveBack(pull, { env })).toBe('done');

    const linked = fresh('linked');
    symlinkSync(fresh('target'), join(linked, `lo-overview-${process.getuid?.() ?? ''}`));
    expect(lockFolder({ TMPDIR: linked })).toBeUndefined();
  });
});

/** A clone in a folder of its own, with what `.lo/settings.json` holds, if anything. */
function clone(settings?: string): string {
  const top = fresh('clone');
  mkdirSync(join(top, '.git'));
  if (settings !== undefined) {
    mkdirSync(join(top, '.lo'));
    writeFileSync(join(top, '.lo', 'settings.json'), settings);
  }
  return top;
}

/** What Claude Code gives the hook after a Bash call that ran `command` in `cwd`. */
function claudeInput(command: string, cwd: string, stdout = 'To o\n   a..b  work -> work'): object {
  return {
    session_id: 's',
    transcript_path: '/x/s.jsonl',
    cwd,
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command, description: 'Push' },
    tool_response: { stdout, stderr: '', interrupted: false, isImage: false },
    tool_use_id: `toolu_${made++}`,
  };
}

/** The hook's answer to `input`, as JSON, with branches' pull requests found in `found`. */
function answer(input: object, env: NodeJS.ProcessEnv, found: Record<string, string> = {}) {
  const said = hook(input, {
    env,
    find: (_dir, branch) => pullOf(found[branch === CURRENT ? '*' : branch]),
  });
  return said === undefined ? undefined : JSON.parse(said).hookSpecificOutput;
}

describe('the hook', () => {
  const link = 'https://github.com/acme/demo/pull/7';

  test('asks Claude Code to start the skill in the background, once per writer', () => {
    const env = { TMPDIR: fresh('tmp'), HOME: fresh('home') };
    const top = clone();
    const first = answer(claudeInput('git push', top), env, { '*': link });
    expect(first.hookEventName).toBe('PostToolUse');
    expect(first.additionalContext).toContain(`write the overview of ${link} for this push`);
    expect(first.additionalContext).toContain('`mktemp -d`');
    expect(first.additionalContext).toContain(
      `Start the lo-overview skill with the arguments \`${link} <folder>/handoff.md\`. It runs in the background`,
    );
    // Short: the brief is the handoff file's.
    expect(first.additionalContext.length).toBeLessThan(1000);
    const second = answer(claudeInput('git push origin work', top), env, { work: link });
    expect(second.additionalContext).toBe(
      `Lo: the overview of ${link} is being written, and will be updated for this push once that's done. Don't start the lo-overview skill for it now.`,
    );
  });

  test('asks Codex to start it with spawn_agent, from what Codex gives it', () => {
    const env = { TMPDIR: fresh('tmp'), HOME: fresh('home') };
    const top = clone();
    const said = answer(
      {
        session_id: 's',
        turn_id: 't',
        transcript_path: '/x/rollout.jsonl',
        cwd: `file://${top}`,
        hook_event_name: 'PostToolUse',
        model: 'gpt',
        tool_name: 'Bash',
        tool_input: { command: ['/bin/zsh', '-lc', 'git push -u origin work'] },
        tool_response: 'Exit code: 0\nOutput:\nTo o\n * [new branch]      work -> work\n',
        tool_use_id: 'call_1',
      },
      env,
      { work: link },
    );
    expect(said.additionalContext).toContain('Start a subagent with spawn_agent');
    expect(said.additionalContext).toContain(`\`${link} <folder>/handoff.md\``);
    // A failed command, which Codex gives the hook too, starts nothing.
    expect(
      answer(
        {
          ...claudeInput('git push', top),
          turn_id: 't',
          tool_response: 'Exit code: 1\nOutput:\nfatal: x',
        },
        { TMPDIR: fresh('tmp'), HOME: env.HOME },
        { '*': link },
      ),
    ).toBeUndefined();
  });

  test('finds an opened pull request from what was printed, or what Claude Code read of it', () => {
    const env = { TMPDIR: fresh('tmp'), HOME: fresh('home') };
    const top = clone();
    const created = answer(
      claudeInput(
        'gh pr create --fill',
        top,
        'Creating pull request\nhttps://github.com/acme/demo/pull/9\n',
      ),
      env,
    );
    expect(created.additionalContext).toContain('https://github.com/acme/demo/pull/9');
    const read = {
      ...claudeInput('gh pr create --fill', top, ''),
      tool_response: {
        stdout: '',
        gitOperation: { pr: { url: 'https://github.com/acme/demo/pull/10' } },
      },
    };
    expect(answer(read, env).additionalContext).toContain('/pull/10 ');
    // An MCP tool's answer, in its own shape.
    const mcp = {
      ...claudeInput('', top),
      tool_name: 'mcp__github__create_pull_request',
      tool_input: { owner: 'acme', repo: 'demo' },
      tool_response: [
        { type: 'text', text: '{"number":11,"html_url":"https://github.com/acme/demo/pull/11"}' },
      ],
    };
    expect(answer(mcp, env).additionalContext).toContain('/pull/11 ');
  });

  test('answers once for a command that pushes and opens the same pull request', () => {
    const env = { TMPDIR: fresh('tmp'), HOME: fresh('home') };
    const top = clone();
    const input = claudeInput('git push -u origin work && gh pr create --fill', top, `${link}\n`);
    // Claude Code runs it once for each of the hook's rules the command matches.
    expect(answer(input, env, { work: link }).additionalContext).toContain(
      'Start the lo-overview skill',
    );
    expect(answer(input, env, { work: link })).toBeUndefined();
  });

  test('says nothing when it’s off, the push changed nothing, or there’s no open pull request', () => {
    const home = fresh('home');
    const env = { TMPDIR: fresh('tmp'), HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
    expect(
      answer(claudeInput('git push', clone('{ "overview.auto": false }')), env, { '*': link }),
    ).toBeUndefined();
    const top = clone();
    expect(
      answer(claudeInput('git push', top, 'Everything up-to-date'), env, { '*': link }),
    ).toBeUndefined();
    expect(answer(claudeInput('git push', top), env)).toBeUndefined();
    expect(answer(claudeInput('ls', top), env, { '*': link })).toBeUndefined();
    expect(
      answer({ ...claudeInput('git push', top), hook_event_name: 'PreToolUse' }, env, {
        '*': link,
      }),
    ).toBeUndefined();
    for (const input of [null, [], 'x', {}]) expect(hook(input, { env })).toBeUndefined();
    mkdirSync(join(home, '.config', 'lo'), { recursive: true });
    writeFileSync(join(home, '.config', 'lo', 'settings.json'), '{ "overview.auto": false }');
    expect(answer(claudeInput('git push', top), env, { '*': link })).toBeUndefined();
    // Nothing was locked, so nothing waits.
    const locks = join(env.TMPDIR, `lo-overview-${process.getuid?.() ?? ''}`);
    expect(existsSync(locks) ? readdirSync(locks) : []).toEqual([]);
  });

  test('says how to start each pull request’s writer, and that the others are being written', () => {
    const one = pullOf(link)!;
    const two = pullOf('https://github.com/acme/demo/pull/8')!;
    const said = answerFor(
      [
        { pull: one, lock: 'held' },
        { pull: two, lock: 'taken' },
      ],
      'claude',
    );
    expect(said.split('\n')).toHaveLength(4);
    expect(said).toContain(`${link} is being written`);
    expect(said).toContain(`write the overview of ${two.url}`);
  });
});

/** A `gh` that answers `gh pr view` with `view`, and says what it was asked in `asked`. */
function fakeGh(view: string): { bin: string; asked: string } {
  const bin = fresh('bin');
  const asked = join(bin, 'asked');
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${asked}'\n[ "$1 $2" = 'pr view' ] && printf '%s\\n' '${view}'\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return { bin, asked };
}

/** Runs the hook with `input` on its standard input, with `bin` first on the path. */
function run(input: string, bin: string, tmp = fresh('tmp')) {
  return spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: fresh('home'), TMPDIR: tmp },
  });
}

describe('the hook, run as a script', () => {
  test('asks gh for the pushed branch’s open pull request, and answers', () => {
    const { bin, asked } = fakeGh('{"url":"https://github.com/acme/demo/pull/7","state":"OPEN"}');
    const top = clone();
    const ran = run(JSON.stringify(claudeInput('git push origin work', top)), bin);
    expect(ran.status).toBe(0);
    expect(ran.stderr).toBe('');
    expect(JSON.parse(ran.stdout).hookSpecificOutput.additionalContext).toContain('/pull/7 ');
    expect(existsSync(asked)).toBe(true);
    expect(readFileSync(asked, 'utf8')).toBe('pr view --json url,state -- work\n');
  });

  test('says nothing for a closed pull request, a branch that reads as an option, or bad input', () => {
    const { bin, asked } = fakeGh('{"url":"https://github.com/acme/demo/pull/7","state":"MERGED"}');
    const top = clone();
    for (const input of [
      JSON.stringify(claudeInput('git push', top)),
      JSON.stringify(claudeInput('git push origin -- -web', top)),
      'not JSON',
      '',
    ]) {
      const { status, stdout, stderr } = run(input, bin);
      expect({ input, status, stdout, stderr }).toEqual({
        input,
        status: 0,
        stdout: '',
        stderr: '',
      });
    }
    // `-web` was never handed to gh.
    expect(readFileSync(asked, 'utf8')).toBe('pr view --json url,state\n');
  });
});
