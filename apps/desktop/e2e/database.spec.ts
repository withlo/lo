import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import { appEnvironment, appFolder, dataFolder, electronBinary, expect, test } from './app.ts';

function rows(path: string, sql: string): unknown[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

test('the database opens on a fresh data folder, with its migrations table', async ({ page }) => {
  await expect(page.locator('header.strip')).toBeVisible();
  const file = join(dataFolder(), 'lo.db');
  expect(rows(file, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
  expect(rows(file, "SELECT name FROM sqlite_schema WHERE type = 'table'")).toEqual([
    { name: 'migrations' },
  ]);
  // Lo itself has no tables yet; each feature brings its own.
  expect(rows(file, 'SELECT * FROM migrations')).toEqual([]);
});

test("a database a newer Lo wrote isn't opened, and Lo says why", async () => {
  const folder = test.info().outputPath('newer');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'lo.db');
  const newer = new DatabaseSync(file);
  newer.exec(`
    CREATE TABLE migrations (
      feature TEXT NOT NULL, number INTEGER NOT NULL, file TEXT NOT NULL, sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL, PRIMARY KEY (feature, number)
    ) STRICT;
    INSERT INTO migrations VALUES ('app', 1, '001-app.sql', '${'0'.repeat(64)}', '2027-01-01');
  `);
  newer.close();

  const started = promisify(execFile)(electronBinary, [appFolder], {
    env: appEnvironment(folder),
    timeout: 20_000,
  });
  await expect(started).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining(
      "Lo couldn't start. Lo's database was last opened by a newer version of Lo",
    ),
  });
  expect(rows(file, "SELECT name FROM sqlite_schema WHERE type = 'table'")).toEqual([
    { name: 'migrations' },
  ]);
  expect(rows(file, 'SELECT feature, number FROM migrations')).toEqual([
    { feature: 'app', number: 1 },
  ]);
});
