import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findPopups, NOT_YET } from './popups.ts';

const script = new URL('./check-popups.ts', import.meta.url).pathname;

describe('findPopups', () => {
  it('finds a popup however it is imported, and leaves the parts that stay in the page', () => {
    const source = [
      "import { Menu } from '@base-ui/react/menu';",
      "import { Switch } from '@base-ui/react/switch';",
      "export { Tooltip } from '@base-ui/react/tooltip';",
      "const later = import('@base-ui/react/dialog');",
      "import * as Everything from '@base-ui/react';",
    ].join('\n');
    expect(findPopups('a.tsx', source).map(({ line, module }) => [line, module])).toEqual([
      [1, '@base-ui/react/menu'],
      [5, '@base-ui/react'],
      [3, '@base-ui/react/tooltip'],
      [4, '@base-ui/react/dialog'],
    ]);
  });
});

describe('check-popups', () => {
  let folder: string;

  /** Writes the files the check excuses for now, each still drawing its popup, and `more`. */
  function write(more: Record<string, string>) {
    const excused = Object.fromEntries(
      NOT_YET.map((path) => [path, "import { Menu } from '@base-ui/react/menu';\n"]),
    );
    for (const [path, content] of Object.entries({ ...excused, ...more })) {
      mkdirSync(join(folder, path, '..'), { recursive: true });
      writeFileSync(join(folder, path), content);
    }
  }

  const check = () => spawnSync(process.execPath, [script, folder], { encoding: 'utf8' });

  beforeEach(() => {
    folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-popups-')));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('passes the shared pieces, and fails a file that draws a popup of its own', () => {
    write({ 'Dialog.tsx': "import { Dialog } from '@base-ui/react/dialog';\n" });
    expect(check().status).toBe(0);
    write({ 'Thing.tsx': "\nimport { Popover } from '@base-ui/react/popover';\n" });
    const { status, stderr } = check();
    expect(status).toBe(1);
    expect(stderr).toContain('Thing.tsx:2: imports @base-ui/react/popover.');
  });

  it('fails once a file excused for now has moved to a shared piece', () => {
    write({ 'KeyHelp.tsx': "import { Dialog } from './Dialog.tsx';\n" });
    const { status, stderr } = check();
    expect(status).toBe(1);
    expect(stderr).toContain('KeyHelp.tsx no longer draws a popup of its own.');
  });
});
