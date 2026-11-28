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
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  actionsIn,
  answerFor,
  branchOf,
  clearStale,
  commandsIn,
  CURRENT,
  failedOrIdle,
  giveBack,
  hook,
  keepLock,
  lastPullIn,
  LOCK_MS,
  cloneLink,
  lockFolder,
  lockFolders,
  offBy,
  personalSettings,
  pullOf,
  readJsonc,
  takeLock,
  textOf,
  tmpLockFolder,
} from '@lo/skill/hook.mjs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { git } from '@lo/testing/git';

import { repositoryOf, scratch } from './support.ts';

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

/**
 * What `actionsIn` makes of `command` in `/work`, with each branch by name, `*` for the current, and
 * the remote or `--head` it names.
 */
function pushed(command: string): string[] {
  return actionsIn(command, '/work').map((action) =>
    action.kind === 'create'
      ? `create${action.head === undefined ? '' : ` ${action.head}`} in ${action.dir}`
      : `push ${action.branches.map((branch) => (branch === CURRENT ? '*' : branch)).join(',')}${action.remote === undefined ? '' : ` to ${action.remote}`} in ${action.dir}`,
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
    expect(commandsIn('cat <<EOF > x\nrm -rf /\nEOF\nls')).toEqual([['cat'], ['ls']]);
  });

  test('takes in every push of a branch, wherever it runs', () => {
    expect(pushed('git push')).toEqual(['push * in /work']);
    expect(pushed('git push -u origin HEAD')).toEqual(['push * to origin in /work']);
    expect(pushed('git push origin work +other refs/heads/a:refs/heads/b')).toEqual([
      'push work,other,b to origin in /work',
    ]);
    expect(pushed('git push --force-with-lease fork @')).toEqual(['push * to fork in /work']);
    expect(pushed('git push -o ci.skip origin work')).toEqual(['push work to origin in /work']);
    // The repository, as `--repo` names it, and so the branch checked out.
    expect(pushed('git push --repo origin')).toEqual(['push * in /work']);
    expect(pushed('git push origin -- --odd')).toEqual(['push --odd to origin in /work']);
    expect(pushed('git push --all origin')).toEqual(['push * to origin in /work']);
    expect(pushed('git -C sub -c push.default=current --no-pager push')).toEqual([
      'push * in /work/sub',
    ]);
    expect(pushed('cd /elsewhere && GIT_TRACE=1 env -i git push && cd .. && git push')).toEqual([
      'push * in /elsewhere',
      'push * in /',
    ]);
    expect(pushed('/usr/bin/git push')).toEqual(['push * in /work']);
  });

  test('runs each where the shell would, and leaves out one it can’t tell', () => {
    const home = homedir();
    expect(pushed('git -C ~/x push')).toEqual([`push * in ${join(home, 'x')}`]);
    expect(pushed('git -C~/x push')).toEqual([`push * in ${join(home, 'x')}`]);
    expect(pushed('cd ~ && git push')).toEqual([`push * in ${home}`]);
    expect(pushed('cd -P /a && git push')).toEqual(['push * in /a']);
    // A subshell's `cd` ends with it.
    expect(pushed('(cd sub && git push) && git push')).toEqual([
      'push * in /work/sub',
      'push * in /work',
    ]);
    expect(pushed('(cd /a; (cd b; git push); git push); git push')).toEqual([
      'push * in /a/b',
      'push * in /a',
      'push * in /work',
    ]);
    // A folder named by a variable, a pattern or `-`, or relative to one of those.
    for (const command of [
      'git -C "$R" push',
      'cd $R && git push',
      'cd "$(git rev-parse --show-toplevel)" && git push',
      'cd - && git push',
      'cd sub* && git push',
      'cd ~other && git push',
      'cd $R && cd sub && git push',
      'git --git-dir=/x/.git push',
      'git --work-tree /x push',
    ]) {
      expect({ command, actions: pushed(command) }).toEqual({ command, actions: [] });
    }
    // Until a folder the shell would know again.
    expect(pushed('cd $R && cd /b && git push')).toEqual(['push * in /b']);
    expect(pushed('cd $R; gh pr create; cd /b; gh pr create')).toEqual(['create in /b']);
  });

  test('reads no here-document as commands', () => {
    expect(pushed("cat > notes.md <<'EOF'\ngit push\nEOF\ngit push")).toEqual(['push * in /work']);
    expect(pushed('cat <<-END\n\tgit push origin work\n\tEND\nls')).toEqual([]);
    expect(pushed('git commit -F - <<EOF && git push\nFix\ngit push nope\nEOF')).toEqual([
      'push * in /work',
    ]);
    // A here-string is a word, not a here-document.
    expect(pushed('cat <<< hi\ngit push')).toEqual(['push * in /work']);
  });

  test('takes in opening a pull request, but not a dry run or one in the browser', () => {
    expect(pushed('gh pr create --fill')).toEqual(['create in /work']);
    expect(pushed('git push -u origin work && gh pr new --draft')).toEqual([
      'push work to origin in /work',
      'create in /work',
    ]);
    expect(pushed('gh pr create --head me:feat --fill')).toEqual(['create me:feat in /work']);
    expect(pushed('gh pr create -H feat')).toEqual(['create feat in /work']);
    expect(pushed('gh pr create --head=feat')).toEqual(['create feat in /work']);
    expect(pushed('gh pr create --dry-run')).toEqual([]);
    expect(pushed('gh pr create --web')).toEqual([]);
    expect(pushed('gh pr view 5')).toEqual([]);
  });

  test('leaves out a push of the overview’s own refs, a dry run, a deletion, and tags', () => {
    // The writer's own push, which would otherwise start another writer for ever.
    expect(pushed("git push 'https://github.com/o/r.git' 'abc:refs/lo/pr/5'")).toEqual([]);
    expect(pushed('git push origin HEAD:refs/lo/stack/3 HEAD:refs/lo/terms')).toEqual([]);
    expect(pushed('git push origin HEAD:refs/lo/pr/5 work')).toEqual([
      'push work to origin in /work',
    ]);
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

/** A repository of its own, whose git folder keeps its locks. */
function lockingRepo(): string {
  const dir = fresh('repo');
  git(dir, 'init', '-q');
  return dir;
}

/** The folder of locks in the repository at `dir`. */
function locksIn(dir: string): string {
  return join(realpathSync(dir), '.git', 'lo-overview');
}

/** A temporary folder of the test's own for the person's folder of locks there. */
function tmpEnv(): { LO_OVERVIEW_TMP: string } {
  return { LO_OVERVIEW_TMP: fresh('tmp') };
}

/** What's in `folder`, if it's there, in order. */
function inFolder(folder: string): string[] {
  return existsSync(folder) ? readdirSync(folder).toSorted() : [];
}

describe('one writer per pull request', () => {
  const pull = pullOf('https://github.com/Acme/Demo/pull/7')!;

  test('takes the lock, holds it with one follow-up, and gives it back', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    expect(takeLock(pull, { dir, env, call: 'a' })).toBe('taken');
    // The same call again, as one that pushes and opens a pull request runs the hook twice.
    expect(takeLock(pull, { dir, env, call: 'a' })).toBe('same');
    expect(takeLock(pull, { dir, env, call: 'b' })).toBe('held');
    expect(takeLock(pull, { dir, env, call: 'c' })).toBe('held');
    // Case is the same pull request on GitHub.
    expect(takeLock(pullOf('https://github.com/acme/demo/pull/7')!, { dir, env })).toBe('held');
    // One follow-up, however many pushes came.
    expect(giveBack(pull, { dir, env })).toBe('again');
    expect(takeLock(pull, { dir, env, call: 'd' })).toBe('held');
    expect(giveBack(pull, { dir, env })).toBe('again');
    expect(giveBack(pull, { dir, env })).toBe('done');
    expect(takeLock(pull, { dir, env, call: 'e' })).toBe('taken');
    // Another pull request has a lock of its own.
    expect(takeLock(pullOf('https://github.com/acme/demo/pull/8')!, { dir, env })).toBe('taken');
  });

  test('lapses a lock no writer kept within its time, follow-up and all', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    expect(takeLock(pull, { dir, env })).toBe('taken');
    expect(takeLock(pull, { dir, env })).toBe('held');
    const later = Date.now() + LOCK_MS + 1000;
    expect(takeLock(pull, { dir, env, now: later })).toBe('taken');
    // The follow-up went with it.
    expect(giveBack(pull, { dir, env })).toBe('done');
    // A writer that starts keeps it, as one does.
    expect(keepLock(pull, { dir, env })).toBe('kept');
    expect(takeLock(pull, { dir, env })).toBe('held');
  });

  test('keeps them in the repository’s git folder, which its worktrees share, whatever TMPDIR says', () => {
    const dir = lockingRepo();
    const tmp = tmpEnv();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'Start');
    const tree = join(fresh('worktrees'), 'tree');
    git(dir, 'worktree', 'add', '-q', tree);
    mkdirSync(join(tree, 'deep'));
    expect(lockFolder(dir)).toBe(locksIn(dir));
    expect(lockFolder(join(tree, 'deep'), { TMPDIR: fresh('tmpdir') })).toBe(locksIn(dir));
    // A sandboxed command's TMPDIR is another, which the hook never sees: the lock is the same.
    expect(takeLock(pull, { dir: tree, env: { ...tmp, TMPDIR: fresh('sandboxed') } })).toBe(
      'taken',
    );
    expect(takeLock(pull, { dir, env: { ...tmp, TMPDIR: fresh('hook') } })).toBe('held');
    expect(giveBack(pull, { dir: tree, env: tmp })).toBe('again');
    expect(inFolder(locksIn(dir))).toEqual(['acme.demo.7.lock']);
  });

  test('takes it in /tmp for Codex, whose sandbox lets its commands write there and no git folder', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    const tmp = tmpLockFolder(env);
    expect(tmp).toBe(join(env.LO_OVERVIEW_TMP, `lo-overview-${process.getuid?.() ?? ''}`));
    expect(takeLock(pull, { dir, env, host: 'codex' })).toBe('taken');
    expect(inFolder(tmp)).toEqual(['acme.demo.7.lock']);
    expect(inFolder(locksIn(dir))).toEqual([]);
    // Held wherever it is: a push from Claude Code meanwhile is told so, and leaves its follow-up
    // beside it.
    expect(takeLock(pull, { dir, env, host: 'claude' })).toBe('held');
    expect(inFolder(tmp)).toEqual(['acme.demo.7.again', 'acme.demo.7.lock']);
    expect(lockFolders(dir, env)).toEqual([locksIn(dir), tmp]);
    expect(lockFolders(dir, env, { first: 'tmp' })).toEqual([tmp, locksIn(dir)]);
  });

  test.skipIf(process.getuid?.() === 0)(
    'lets a writer that can’t write the git folder keep, and give back, the lock in /tmp',
    () => {
      const dir = lockingRepo();
      const env = tmpEnv();
      expect(takeLock(pull, { dir, env, host: 'codex' })).toBe('taken');
      expect(takeLock(pull, { dir, env, host: 'codex' })).toBe('held');
      // As in Codex's sandbox, whose commands can't write a git folder.
      const gitFolder = locksIn(dir);
      chmodSync(gitFolder, 0o500);
      try {
        expect(keepLock(pull, { dir, env })).toBe('kept');
        expect(giveBack(pull, { dir, env })).toBe('again');
        expect(giveBack(pull, { dir, env })).toBe('done');
        // With none to keep, it takes one where it can write.
        expect(keepLock(pull, { dir, env })).toBe('kept');
        expect(inFolder(tmpLockFolder(env))).toEqual(['acme.demo.7.lock']);
      } finally {
        chmodSync(gitFolder, 0o700);
      }
    },
  );

  test('keeps locks only in folders of the person’s own, and says when it couldn’t', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    const folder = lockFolder(dir)!;
    chmodSync(folder, 0o777);
    expect(lockFolder(dir)).toBeUndefined();
    // Only /tmp's is left.
    expect(lockFolders(dir, env)).toEqual([tmpLockFolder(env)]);
    chmodSync(tmpLockFolder(env), 0o777);
    expect(takeLock(pull, { dir, env })).toBe('unlocked');
    expect(keepLock(pull, { dir, env })).toBe('failed');

    const linked = lockingRepo();
    symlinkSync(fresh('target'), join(linked, '.git', 'lo-overview'));
    expect(lockFolder(linked)).toBeUndefined();
    // Outside any repository there's no git folder, so done can't tell what's left in one.
    const nowhere = fresh('nowhere');
    expect(lockFolder(nowhere)).toBeUndefined();
    expect(giveBack(pull, { dir: nowhere, env: tmpEnv() })).toBe('failed');
  });

  test.skipIf(process.getuid?.() === 0)(
    'says it couldn’t give the lock back when its follow-up can’t be taken',
    () => {
      const dir = lockingRepo();
      const env = tmpEnv();
      expect(takeLock(pull, { dir, env })).toBe('taken');
      expect(takeLock(pull, { dir, env })).toBe('held');
      const folder = lockFolder(dir)!;
      chmodSync(folder, 0o500);
      try {
        expect(giveBack(pull, { dir, env })).toBe('failed');
      } finally {
        chmodSync(folder, 0o700);
      }
      // The follow-up is still there for the writer.
      expect(giveBack(pull, { dir, env })).toBe('again');
    },
  );

  test('takes the lock itself when the writer gave it back as the follow-up was recorded', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    const folder = lockFolder(dir)!;
    expect(takeLock(pull, { dir, env })).toBe('taken');
    // The writer's `done` looked for a follow-up, found none, and takes the lock away just after.
    const gone = () => rmSync(join(folder, 'acme.demo.7.lock'));
    expect(takeLock(pull, { dir, env, meanwhile: gone })).toBe('taken');
    expect(readdirSync(folder)).toEqual(['acme.demo.7.lock']);
  });

  test('hands the writer a follow-up recorded as it gave the lock back', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    const folder = lockFolder(dir)!;
    expect(takeLock(pull, { dir, env })).toBe('taken');
    // The hook saw the lock held, and records its follow-up as the lock goes.
    const recorded = () => writeFileSync(join(folder, 'acme.demo.7.again'), `${pull.url}\n`);
    expect(giveBack(pull, { dir, env, meanwhile: recorded })).toBe('again');
    expect(takeLock(pull, { dir, env })).toBe('held');
    expect(giveBack(pull, { dir, env })).toBe('again');
    expect(giveBack(pull, { dir, env })).toBe('done');
  });

  test('drops a follow-up no writer is left to take, as a new writer reads it all', () => {
    const dir = lockingRepo();
    const env = tmpEnv();
    const folder = lockFolder(dir)!;
    writeFileSync(join(folder, 'acme.demo.7.again'), `${pull.url}\n`);
    expect(takeLock(pull, { dir, env })).toBe('taken');
    expect(giveBack(pull, { dir, env })).toBe('done');
  });

  test('moves a lapsed lock aside before it removes it, and puts back one taken meanwhile', () => {
    const folder = lockFolder(lockingRepo())!;
    const lock = join(folder, 'acme.demo.7.lock');
    const again = join(folder, 'acme.demo.7.again');
    writeFileSync(lock, '{}\n');
    writeFileSync(again, 'x\n');
    // Looked at as lapsed, but taken again by the time it's moved: it stands, follow-up and all.
    clearStale(lock, again, Date.now());
    expect(readdirSync(folder).toSorted()).toEqual(['acme.demo.7.again', 'acme.demo.7.lock']);
    // Lapsed: both go, and nothing's left beside them.
    clearStale(lock, again, Date.now() + LOCK_MS + 1000);
    expect(readdirSync(folder)).toEqual([]);
  });
});

/**
 * A clone in a folder of its own that installed the skill, with what `.lo/settings.json` holds, if
 * anything.
 */
function clone(settings?: string): string {
  const top = fresh('clone');
  git(top, 'init', '-q');
  mkdirSync(join(top, '.claude', 'skills', 'lo-overview'), { recursive: true });
  writeFileSync(
    join(top, '.claude', 'skills', 'lo-overview', 'SKILL.md'),
    '---\nname: lo-overview\n---\n',
  );
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
    find: (_dir, { branch }) => pullOf(found[branch === CURRENT ? '*' : branch]),
  });
  return said === undefined ? undefined : JSON.parse(said).hookSpecificOutput;
}

describe('the hook', () => {
  const link = 'https://github.com/acme/demo/pull/7';

  test('asks Claude Code to start the skill in the background, once per writer', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const top = clone();
    const first = answer(claudeInput('git push', top), env, { '*': link });
    expect(first.hookEventName).toBe('PostToolUse');
    expect(first.additionalContext).toContain(`write the overview of ${link} for this push`);
    expect(first.additionalContext).toContain('`mktemp -d`');
    expect(first.additionalContext).toContain(
      `Start the lo-overview skill with the arguments \`${link} <folder>/handoff.md ${cloneLink(top)}\`. It runs in the background`,
    );
    // Short: the brief is the handoff file's.
    expect(first.additionalContext.length).toBeLessThan(1000);
    const second = answer(claudeInput('git push origin work', top), env, { work: link });
    expect(second.additionalContext).toBe(
      `Lo: the overview of ${link} is being written, and will be updated for this push once that's done. Don't start the lo-overview skill for it now.`,
    );
  });

  test('asks Codex to start it with spawn_agent, from what Codex gives it', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
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
    expect(said.additionalContext).toContain(`\`${link} <folder>/handoff.md ${cloneLink(top)}\``);
    // Codex's writer keeps its lock in /tmp, as Codex's sandbox lets its commands write there.
    expect(readdirSync(tmpLockFolder(env))).toEqual(['acme.demo.7.lock']);
    // A failed command, which Codex gives the hook too, starts nothing.
    expect(
      answer(
        {
          ...claudeInput('git push', top),
          turn_id: 't',
          tool_response: 'Exit code: 1\nOutput:\nfatal: x',
        },
        { HOME: env.HOME, ...tmpEnv() },
        { '*': link },
      ),
    ).toBeUndefined();
  });

  test('finds an opened pull request from what was printed, or what Claude Code read of it', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
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
    const env = { HOME: fresh('home'), ...tmpEnv() };
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
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), ...tmpEnv() };
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
    const locks = join(top, '.git', 'lo-overview');
    expect(existsSync(locks) ? readdirSync(locks) : []).toEqual([]);
  });

  test('says nothing for a clone that never installed the skill, or a folder it can’t tell', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const top = clone();
    const other = fresh('other');
    mkdirSync(join(other, '.git'));
    expect(answer(claudeInput('git push', other), env, { '*': link })).toBeUndefined();
    expect(answer(claudeInput(`git -C '${other}' push`, top), env, { '*': link })).toBeUndefined();
    expect(answer(claudeInput('cd "$R" && git push', top), env, { '*': link })).toBeUndefined();
    expect(answer(claudeInput('git push', join(top, 'gone')), env, { '*': link })).toBeUndefined();
    const mcp = {
      ...claudeInput('', other),
      tool_name: 'mcp__github__create_pull_request',
      tool_response: [{ type: 'text', text: link }],
    };
    expect(answer(mcp, env)).toBeUndefined();
    // From the clone's own folder, a push in the other doesn't count, and its own does.
    expect(
      answer(claudeInput(`git -C '${other}' push && git push`, top), env, { '*': link })
        .additionalContext,
    ).toContain(link);
  });

  test('says nothing yet for a push that runs in the background', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const input = {
      ...claudeInput('git push', clone(), ''),
      tool_input: { command: 'git push', run_in_background: true },
      tool_response: { backgroundTaskId: 'b1', stdout: '', stderr: '' },
    };
    expect(answer(input, env, { '*': link })).toBeUndefined();
  });

  test('takes an opened pull request’s printed link only when it’s the one printed', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const top = clone();
    const printed =
      'https://github.com/acme/demo/pull/9\n{"url":"https://github.com/acme/demo/pull/3"}\n';
    // Codex gives all a command printed, so the second link could be anything's.
    const input = {
      ...claudeInput('gh pr create --fill && gh pr view 3 --json url', top),
      turn_id: 't',
      tool_response: `Exit code: 0\nOutput:\n${printed}`,
    };
    expect(answer(input, env, { '*': link }).additionalContext).toContain(`${link} for this push`);
    expect(answer(input, env)).toBeUndefined();
  });

  test('asks gh about three branches at most, however many a push names', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const asked: string[] = [];
    const said = hook(claudeInput('git push origin a b c d e', clone()), {
      env,
      find: (_dir, { branch }) => {
        asked.push(String(branch));
        return undefined;
      },
    });
    expect(said).toBeUndefined();
    expect(asked).toEqual(['a', 'b', 'c']);
  });

  test('looks for the branch named, on the remote pushed to, or the head gh pr create names', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const top = clone();
    const targets: unknown[] = [];
    const find = (_dir: string, target: unknown) => {
      targets.push(target);
      return undefined;
    };
    hook(claudeInput('git push fork feat', top), { env, find });
    hook(claudeInput('gh pr create --head me:feat', top, ''), { env, find });
    hook(claudeInput('gh pr create', top, ''), { env, find });
    expect(targets).toEqual([
      { branch: 'feat', remote: 'fork' },
      { branch: 'feat', owner: 'me' },
      { branch: CURRENT },
    ]);
  });

  test('says how to start each pull request’s writer, and that the others are being written', () => {
    const one = pullOf(link)!;
    const two = pullOf('https://github.com/acme/demo/pull/8')!;
    const said = answerFor(
      [
        { pull: one, top: '/work/one', lock: 'held' },
        { pull: two, top: '/work/two', lock: 'taken' },
      ],
      'claude',
    );
    expect(said.split('\n')).toHaveLength(4);
    expect(said).toContain(`${link} is being written`);
    expect(said).toContain(`write the overview of ${two.url}`);
    expect(said).toContain(`\`${two.url} <folder>/handoff.md file:///work/two\``);
  });

  test('names the clone the push came from, whose lock it took, for the writer to keep', () => {
    const env = { HOME: fresh('home'), ...tmpEnv() };
    const top = clone();
    const other = clone();
    const said = answer(claudeInput(`cd '${other}' && git push`, top), env, { '*': link });
    expect(said.additionalContext).toContain(`\`${link} <folder>/handoff.md ${cloneLink(other)}\``);
    expect(inFolder(locksIn(other))).toEqual(['acme.demo.7.lock']);
    expect(inFolder(locksIn(top))).toEqual([]);
  });

  test('names a clone whose path holds a space or a quote by a link that holds neither', () => {
    for (const name of ["it's here", 'a b', 'x$(y)`z`']) {
      const top = join(fresh('odd'), name);
      mkdirSync(top);
      const named = cloneLink(top);
      expect(named).toMatch(/^file:\/\/\/[^\s'"$`()]+$/);
      expect(fileURLToPath(named)).toBe(top);
    }
  });
});

/**
 * A `gh` that answers `gh pr view` as GitHub would for a clone of acme/demo, by gh's own rule: a
 * branch by its name alone is a pull request's from acme/demo itself, and `<owner>:<branch>` is
 * one's from a fork, never one from acme/demo. The branch checked out, `work`, is #7's head, `next`
 * is #9's, and `me`'s fork's `feat` is #8's; each in `state`. What it was asked goes in `asked`.
 * Asked about `7` or `topic`, it answers with #7, as gh might.
 */
function fakeGh(state = 'OPEN'): { bin: string; asked: string } {
  const bin = fresh('bin');
  const asked = join(bin, 'asked');
  const view = (number: number, head: string, owner: string) =>
    `'{"url":"https://github.com/acme/demo/pull/${number}","state":"${state}","headRefName":"${head}","headRepositoryOwner":{"login":"${owner}"}}'`;
  writeFileSync(
    join(bin, 'gh'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> '${asked}'`,
      'case "$*" in',
      `  'pr view --json url,state,headRefName,headRepositoryOwner') echo ${view(7, 'work', 'acme')} ;;`,
      `  *' -- work') echo ${view(7, 'work', 'acme')} ;;`,
      `  *' -- next') echo ${view(9, 'next', 'acme')} ;;`,
      `  *' -- me:feat') echo ${view(8, 'feat', 'me')} ;;`,
      // gh reads a number as a pull request's, and may find one by another name.
      `  *' -- 7') echo ${view(7, 'work', 'acme')} ;;`,
      `  *' -- topic') echo ${view(7, 'work', 'acme')} ;;`,
      '  *) echo "no pull requests found" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return { bin, asked };
}

/** A real clone of acme/demo, with `work` checked out and `me`'s fork as a remote. */
function realClone(): string {
  const top = clone();
  rmSync(join(top, '.git'), { recursive: true });
  repositoryOf(top, { 'a.txt': 'a\n' });
  git(top, 'checkout', '-q', '-b', 'work');
  git(top, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git');
  git(top, 'remote', 'add', 'fork', 'git@github.com:me/demo.git');
  return top;
}

/** Runs the hook with `input` on its standard input, with `bin` first on the path. */
function run(input: string, bin: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: fresh('home'), ...tmpEnv(), ...env },
  });
}

/** Gives back every lock the clone at `top` keeps, as each writer would. */
function unlock(top: string): void {
  rmSync(join(top, '.git', 'lo-overview'), { recursive: true, force: true });
}

/** The pull request the hook asks the agent to write the overview of, if any. */
function answered(ran: ReturnType<typeof run>): string | undefined {
  expect(ran.status).toBe(0);
  expect(ran.stderr).toBe('');
  if (ran.stdout === '') return undefined;
  const said: string = JSON.parse(ran.stdout).hookSpecificOutput.additionalContext;
  return /write the overview of (\S+) for this push/.exec(said)?.[1];
}

/** What `gh` was asked to view, one line for each time. */
function views(asked: string): string[] {
  return readFileSync(asked, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) =>
      line.replace('pr view --json url,state,headRefName,headRepositoryOwner', 'view'),
    );
}

describe('the hook, run as a script', () => {
  test('asks gh for the open pull request of the branch checked out, by what gh reads of it', () => {
    const { bin, asked } = fakeGh();
    const top = realClone();
    for (const command of ['git push', 'git push -u origin work', 'git push origin HEAD']) {
      expect(answered(run(JSON.stringify(claudeInput(command, top)), bin))).toBe(
        'https://github.com/acme/demo/pull/7',
      );
      unlock(top);
    }
    expect(views(asked)).toEqual(['view', 'view', 'view']);
  });

  test('asks for another branch by its name when it went to the repository gh looks in', () => {
    const { bin, asked } = fakeGh();
    const top = realClone();
    expect(answered(run(JSON.stringify(claudeInput('git push origin local:next', top)), bin))).toBe(
      'https://github.com/acme/demo/pull/9',
    );
    expect(views(asked)).toEqual(['view -- next']);
  });

  test('asks for a fork’s branch by the fork’s owner, as gh matches only so', () => {
    const { bin, asked } = fakeGh();
    const top = realClone();
    expect(answered(run(JSON.stringify(claudeInput('git push fork feat', top)), bin))).toBe(
      'https://github.com/acme/demo/pull/8',
    );
    // A pull request opened from the fork, by its owner, and one from acme/demo's own branch.
    unlock(top);
    const created = claudeInput('gh pr create --head me:feat --fill', top, '');
    expect(answered(run(JSON.stringify(created), bin))).toBe('https://github.com/acme/demo/pull/8');
    unlock(top);
    const own = claudeInput('gh pr create --head acme:next --fill', top, '');
    expect(answered(run(JSON.stringify(own), bin))).toBe('https://github.com/acme/demo/pull/9');
    expect(views(asked)).toEqual(['view -- me:feat', 'view -- me:feat', 'view -- next']);
  });

  test('looks where gh would: GH_REPO, then the default set, then upstream before origin', () => {
    const { bin, asked } = fakeGh();
    const top = realClone();
    const push = JSON.stringify(claudeInput('git push origin local:next', top));
    // acme/demo is the fork when me/demo is the repository gh looks in.
    run(push, bin, { GH_REPO: 'me/demo' });
    unlock(top);
    git(top, 'config', 'remote.fork.gh-resolved', 'base');
    run(push, bin);
    unlock(top);
    git(top, 'config', '--unset', 'remote.fork.gh-resolved');
    git(top, 'remote', 'add', 'upstream', 'https://github.com/me/demo');
    run(push, bin);
    expect(views(asked)).toEqual(['view -- acme:next', 'view -- acme:next', 'view -- acme:next']);
  });

  test('takes no pull request whose head isn’t the branch pushed', () => {
    const { bin, asked } = fakeGh();
    const top = realClone();
    // A branch named `7`, which gh would read as #7: never asked about by its name alone.
    expect(
      answered(run(JSON.stringify(claudeInput('git push origin 7', top)), bin)),
    ).toBeUndefined();
    expect(existsSync(asked)).toBe(false);
    // One gh finds by another name, #7 for `topic`, isn't taken.
    expect(
      answered(run(JSON.stringify(claudeInput('git push origin work:topic', top)), bin)),
    ).toBeUndefined();
    expect(views(asked)).toEqual(['view -- topic']);
  });

  test('says nothing for a closed pull request, a branch that reads as an option, or bad input', () => {
    const { bin, asked } = fakeGh('MERGED');
    const top = realClone();
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
    expect(views(asked)).toEqual(['view']);
  });
});
