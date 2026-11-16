import { describe, expect, it } from 'vitest';

import { editSettings, parseSettings } from './text.ts';

const problemOf = (read: ReturnType<typeof parseSettings>) =>
  read.kind === 'problem' ? read.problem : undefined;

/** A settings file as people write them, in an editor that takes comments. */
const COMMENTED = `// Lo's settings.
// Each key is written out whole.
// See docs/settings.md.
{
  "theme": "dark", // at night
  /* The diff. */
  "diff.layout":   "split",
  "later": [1, 2]
}
`;

describe('parseSettings', () => {
  it('reads one JSON object, keeping every key in it, known or not', () => {
    const text = '{ "theme": "dark", "diff.layout": "inline", "later": [1, { "a": null }] }';
    expect(parseSettings(text)).toEqual({
      kind: 'ok',
      values: { theme: 'dark', 'diff.layout': 'inline', later: [1, { a: null }] },
      text,
      repeated: [],
    });
  });

  it('reads a file with nothing in it, only white space or only comments, as no settings', () => {
    for (const text of ['', ' \n\t\n', '{}', '// Nothing yet.\n', '/* Later. */']) {
      expect(parseSettings(text)).toEqual({ kind: 'ok', values: {}, text, repeated: [] });
    }
  });

  it('reads comments of both kinds, and a comma after the last entry, as editors allow', () => {
    expect(parseSettings(COMMENTED)).toMatchObject({
      kind: 'ok',
      values: { theme: 'dark', 'diff.layout': 'split', later: [1, 2] },
    });
    const trailing = '{\n  "theme": "dark",\n  "later": [1, 2,],\n}\n';
    expect(parseSettings(trailing)).toMatchObject({
      kind: 'ok',
      values: { theme: 'dark', later: [1, 2] },
    });
    // A comment's text is never read as a key.
    expect(parseSettings('{ /* "theme": "light", */ "theme": "dark" // , "x": 1\n}')).toMatchObject(
      {
        values: { theme: 'dark' },
      },
    );
  });

  it('says what is wrong with text that is not JSON, and where', () => {
    const fix = 'Fix it, and Lo applies it as soon as you save.';
    expect(problemOf(parseSettings('{ "theme": }'))).toBe(
      `The settings file isn't valid JSON (Lo expected a value at line 1, column 12). ${fix}`,
    );
    // Lines are counted past comments, at the key the comma should come before.
    expect(problemOf(parseSettings(`${COMMENTED.slice(0, -2)}  "x": 1\n}\n`))).toBe(
      `The settings file isn't valid JSON (Lo expected a comma at line 9, column 3). ${fix}`,
    );
    expect(problemOf(parseSettings('{ "theme": "dark" /* open'))).toContain(
      "a /* comment isn't closed at line 1, column 19",
    );
    expect(problemOf(parseSettings("{ 'theme': 'dark' }"))).toContain(
      "Lo found something JSON doesn't have at line 1, column 3",
    );
    expect(problemOf(parseSettings('{ "theme": "dark" } {}'))).toContain(
      'Lo expected nothing more after the object',
    );
  });

  it('says so when the text is JSON but not one object', () => {
    for (const text of ['null', '[]', '[{"theme":"dark"}]', '"dark"', '3', 'true', '// x\n[]']) {
      expect(problemOf(parseSettings(text))).toBe(
        'The settings file should hold one JSON object, such as { "theme": "dark" }. Fix it, and Lo applies it as soon as you save.',
      );
    }
  });

  it('keeps a key called __proto__ as the plain key it is, and does not become its object’s prototype', () => {
    const read = parseSettings('{ "__proto__": { "theme": "light" }, "x": { "__proto__": 1 } }');
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(Object.hasOwn(read.values, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(read.values)).toBe(Object.prototype);
    expect(Object.hasOwn(read.values, 'theme')).toBe(false);
    // And so it is deeper in.
    expect(Object.keys(Object(read.values.x))).toEqual(['__proto__']);
  });

  it('reads a key given more than once as the last says, as JavaScript does, and names it', () => {
    const read = parseSettings('{ "theme": "dark", "x": 1, "theme": "light", "theme": "system" }');
    expect(read).toMatchObject({ kind: 'ok', values: { theme: 'system', x: 1 } });
    expect(read.kind === 'ok' && read.repeated).toEqual(['theme']);
  });

  it('reports a file nested too deeply to read, rather than failing', () => {
    const deep = `{ "x": ${'['.repeat(100_000)}${']'.repeat(100_000)} }`;
    expect(problemOf(parseSettings(deep))).toBe(
      "The settings file is nested too deeply, so Lo didn't read it.",
    );
  });
});

describe('editSettings', () => {
  it('changes only the value, keeping the comments, the order of keys and the spacing', () => {
    expect(editSettings(COMMENTED, 'diff.layout', 'inline')).toBe(
      COMMENTED.replace('"split"', '"inline"'),
    );
    expect(editSettings(COMMENTED, 'theme', 'light')).toBe(COMMENTED.replace('"dark"', '"light"'));
  });

  it('adds a key after the last, in the file’s indent, leaving a comment after the last on its line', () => {
    expect(editSettings(COMMENTED, 'cache.cap', 20)).toBe(
      COMMENTED.replace('"later": [1, 2]\n', '"later": [1, 2],\n  "cache.cap": 20\n'),
    );
    const four = '{\n    "theme": "dark" // at night\n    // More later.\n}\n';
    expect(editSettings(four, 'cache.cap', 20)).toBe(
      '{\n    "theme": "dark", // at night\n    // More later.\n    "cache.cap": 20\n}\n',
    );
  });

  it('gives a new key a comma too when the last has one', () => {
    expect(editSettings('{\n\t"theme": "dark",\n}\n', 'cache.cap', 20)).toBe(
      '{\n\t"theme": "dark",\n\t"cache.cap": 20,\n}\n',
    );
    expect(editSettings('{\n  "theme": "dark", // at night\n}', 'cache.cap', 20)).toBe(
      '{\n  "theme": "dark", // at night\n  "cache.cap": 20,\n}',
    );
  });

  it('lays a list out over lines, in the file’s indent', () => {
    const list = [{ repo: 'withlo/lo', id: 'R_1' }];
    expect(editSettings('{\n\t"code.trusted": []\n}\n', 'code.trusted', list)).toBe(
      '{\n\t"code.trusted": [\n\t\t{\n\t\t\t"repo": "withlo/lo",\n\t\t\t"id": "R_1"\n\t\t}\n\t]\n}\n',
    );
    expect(editSettings('{\n    "theme": "dark"\n}\n', 'code.trusted', list)).toBe(
      '{\n    "theme": "dark",\n    "code.trusted": [\n        {\n            "repo": "withlo/lo",\n            "id": "R_1"\n        }\n    ]\n}\n',
    );
  });

  it('starts an object with two-space indents where the file has none, after any comments', () => {
    expect(editSettings('', 'theme', 'dark')).toBe('{\n  "theme": "dark"\n}\n');
    expect(editSettings('\n\n', 'theme', 'dark')).toBe('{\n  "theme": "dark"\n}\n');
    expect(editSettings('// Mine.\n', 'theme', 'dark')).toBe('// Mine.\n{\n  "theme": "dark"\n}\n');
    expect(editSettings('/* Mine. */', 'theme', 'dark')).toBe(
      '/* Mine. */\n{\n  "theme": "dark"\n}\n',
    );
    expect(editSettings('{}', 'theme', 'dark')).toBe('{\n  "theme": "dark"\n}');
    expect(editSettings('{ }\n', 'theme', 'dark')).toBe('{\n  "theme": "dark"\n}\n');
    expect(editSettings('{\n  // Nothing yet.\n}\n', 'theme', 'dark')).toBe(
      '{\n  // Nothing yet.\n  "theme": "dark"\n}\n',
    );
  });

  it('keeps an object on one line on one line', () => {
    const one = '{ "theme": "dark", "from": { "a newer": ["Lo"] } }\n';
    expect(editSettings(one, 'diff.layout', 'inline')).toBe(
      '{ "theme": "dark", "from": { "a newer": ["Lo"] }, "diff.layout": "inline" }\n',
    );
    expect(editSettings(one, 'from', { b: [1] })).toBe('{ "theme": "dark", "from": {"b":[1]} }\n');
    expect(editSettings('{ "theme": "dark", }', 'x', 1)).toBe('{ "theme": "dark", "x": 1, }');
  });

  it('keeps Windows line breaks', () => {
    expect(editSettings('// Mine.\r\n{\r\n  "theme": "dark"\r\n}\r\n', 'x', [1])).toBe(
      '// Mine.\r\n{\r\n  "theme": "dark",\r\n  "x": [\r\n    1\r\n  ]\r\n}\r\n',
    );
  });

  it('changes nothing it can’t change exactly: a key the file has twice, or a file it can’t read', () => {
    const twice = '{ "theme": "dark", "theme": "light" }';
    expect(() => editSettings(twice, 'theme', 'system')).toThrow(
      'The settings file has theme more than once.',
    );
    // Another key changes, and the one given twice says what it did.
    expect(editSettings(twice, 'x', 1)).toBe('{ "theme": "dark", "theme": "light", "x": 1 }');
    expect(() => editSettings('{ "theme": ', 'theme', 'dark')).toThrow(
      "Lo can't change a settings file it can't read.",
    );
    expect(() => editSettings('[]', 'theme', 'dark')).toThrow(
      "Lo can't change a settings file it can't read.",
    );
  });
});
