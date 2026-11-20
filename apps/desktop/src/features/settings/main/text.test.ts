import type * as jsonc from 'jsonc-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsState } from '../contract.ts';
import { editSettings, parseSettings, SETTINGS_DEPTH_LIMIT, SettingsUneditable } from './text.ts';

/** What a test does to the text each edit makes, as a mistake in making it would. */
const fault = vi.hoisted(() => ({ change: undefined as ((text: string) => string) | undefined }));

vi.mock('jsonc-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof jsonc>();
  return {
    ...actual,
    applyEdits: (...args: Parameters<typeof actual.applyEdits>) => {
      const text = actual.applyEdits(...args);
      return fault.change ? fault.change(text) : text;
    },
  };
});

afterEach(() => {
  fault.change = undefined;
});

/** 0 inside `levels` lists. */
function nested(levels: number): SettingsState['values'][string] {
  let value: SettingsState['values'][string] = 0;
  for (let level = 0; level < levels; level++) value = [value];
  return value;
}

/** A settings file whose objects and lists go `levels` deep, its own object the first. */
const nestedFile = (levels: number) =>
  `{ "x": ${'['.repeat(levels - 1)}0${']'.repeat(levels - 1)} }`;

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

/** The header older versions of Lo wrote at the top of a settings file they made. */
const OLD_HEADER = `// Lo's settings. Lo applies only these from this file and ignores the rest: "theme",
// "ui_font_family", "ui_font_size", "buffer_font_family" and "buffer_font_size".
// A theme's file goes in ~/.config/lo/themes, and "theme" names it. Lo's README says more.
`;

/** What such a file holds after its header. */
const OLD_BODY = `{
  "theme": {
    "mode": "system",
    "light": "Lo Glow Light",
    "dark": "Lo Glow Dark"
  }
}
`;

/** That file with `cache.cap` added after its last setting. */
const OLD_CAPPED = OLD_BODY.replace('  }\n}', '  },\n  "cache.cap": 20\n}');

/** `text` with Windows line breaks. */
const crlf = (text: string) => text.replaceAll('\n', '\r\n');

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
    // And what's wrong alone, for what says what to do in its own words.
    expect(parseSettings('{ "theme": }')).toMatchObject({
      cause: "The settings file isn't valid JSON (Lo expected a value at line 1, column 12).",
    });
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

  it('reads a key given twice deeper in as the last says too, naming only the file’s own keys', () => {
    const text = '{ "x": { "a": 1, "b": [{ "c": 1, "c": 3 }], "a": 2 } }';
    expect(parseSettings(text)).toEqual({
      kind: 'ok',
      values: { x: { a: 2, b: [{ c: 3 }] } },
      text,
      repeated: [],
    });
  });

  it('reads past a byte order mark, keeping it in the text, and counts columns without it', () => {
    const text = '\uFEFF// Mine.\n{ "theme": "dark" }';
    expect(parseSettings(text)).toEqual({
      kind: 'ok',
      values: { theme: 'dark' },
      text,
      repeated: [],
    });
    expect(problemOf(parseSettings('\uFEFF{ "theme": }'))).toContain('at line 1, column 12');
  });

  it('reads objects and lists nested up to the limit, and leaves a file nested deeper unread', () => {
    expect(parseSettings(nestedFile(SETTINGS_DEPTH_LIMIT))).toMatchObject({
      kind: 'ok',
      values: { x: nested(SETTINGS_DEPTH_LIMIT - 1) },
    });
    const deep =
      "The settings file nests objects and lists over 100 levels deep, so Lo didn't read it.";
    expect(problemOf(parseSettings(nestedFile(SETTINGS_DEPTH_LIMIT + 1)))).toBe(deep);
    // Deep enough to run a parser that calls itself out of stack.
    expect(problemOf(parseSettings(nestedFile(100_000)))).toBe(deep);
    // Brackets in strings and comments aren't levels.
    const quoted = `{ "x": "${'['.repeat(200)}" /* ${'{'.repeat(200)} */ }`;
    expect(parseSettings(quoted)).toMatchObject({ kind: 'ok', values: { x: '['.repeat(200) } });
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

  it('keeps a byte order mark', () => {
    expect(editSettings('\uFEFF{\n  "theme": "dark"\n}\n', 'theme', 'light')).toBe(
      '\uFEFF{\n  "theme": "light"\n}\n',
    );
  });

  it('takes out the header an older Lo wrote as it adds or changes a setting, and keeps all else', () => {
    const trusted = [{ repo: 'withlo/lo', id: 'R_1' }];
    expect(editSettings(`${OLD_HEADER}${OLD_BODY}`, 'code.trusted', trusted)).toBe(
      editSettings(OLD_BODY, 'code.trusted', trusted),
    );
    expect(editSettings(`${OLD_HEADER}${OLD_BODY}`, 'cache.cap', 20)).toBe(OLD_CAPPED);
    expect(editSettings(`${OLD_HEADER}${OLD_BODY}`, 'theme', 'dark')).toBe(
      '{\n  "theme": "dark"\n}\n',
    );
    // With nothing under it yet, as with a file of only the header.
    expect(editSettings(OLD_HEADER, 'theme', 'dark')).toBe('{\n  "theme": "dark"\n}\n');
  });

  it('takes it out of a file with Windows line breaks or a byte order mark', () => {
    expect(editSettings(crlf(`${OLD_HEADER}${OLD_BODY}`), 'cache.cap', 20)).toBe(crlf(OLD_CAPPED));
    expect(editSettings(`\uFEFF${OLD_HEADER}${OLD_BODY}`, 'cache.cap', 20)).toBe(
      `\uFEFF${OLD_CAPPED}`,
    );
  });

  it('leaves a header it didn’t write, a changed one among them, and what a person wrote after it', () => {
    const body = '{\n  "theme": "dark"\n}\n';
    const [first, second] = OLD_HEADER.split('\n');
    const kept = [
      '// My settings.\n',
      // Changed by a word, or by an addition, or cut short.
      OLD_HEADER.replace('only these', 'these'),
      OLD_HEADER.replace(/\n$/, ' Mine.\n'),
      `${first}\n${second}\n`,
      // Lo's lines, but after a person's, or after white space: not at the file's start.
      `// Mine.\n${OLD_HEADER}`,
      ` ${OLD_HEADER}`,
      `\n${OLD_HEADER}`,
    ];
    for (const header of kept) {
      expect(editSettings(`${header}${body}`, 'cache.cap', 20)).toBe(
        `${header}{\n  "theme": "dark",\n  "cache.cap": 20\n}\n`,
      );
    }
    // What they wrote under the header stays, and goes to the top.
    expect(editSettings(`${OLD_HEADER}// Mine.\n${body}`, 'cache.cap', 20)).toBe(
      '// Mine.\n{\n  "theme": "dark",\n  "cache.cap": 20\n}\n',
    );
  });

  it('changes nothing it can’t change exactly: a key the file has twice, or a file it can’t read', () => {
    const twice = '{ "theme": "dark", "theme": "light" }';
    expect(() => editSettings(twice, 'theme', 'system')).toThrow(
      new SettingsUneditable('the settings file has it more than once'),
    );
    // Another key changes, and the one given twice says what it did.
    expect(editSettings(twice, 'x', 1)).toBe('{ "theme": "dark", "theme": "light", "x": 1 }');
    for (const text of ['{ "theme": ', '[]', `{ "x": ${JSON.stringify(nested(200))} }`]) {
      expect(() => editSettings(text, 'theme', 'dark')).toThrow(
        new SettingsUneditable('the settings file has a problem'),
      );
    }
  });

  it('reads each change back, and makes none that would read as anything but what was meant', () => {
    const wrong = new SettingsUneditable(
      "the new value, written into the settings file, wouldn't read back as Settings shows it, so Lo left the file as it was",
    );
    // A value that would take the file past the depth Lo reads.
    expect(() => editSettings(COMMENTED, 'later', nested(SETTINGS_DEPTH_LIMIT))).toThrow(wrong);
    // Each a mistake in making the text: the wrong value, another key changed or lost, a key
    // written twice, text that isn't JSON.
    const mistakes = [
      (text: string) => text.replace('"inline"', '"split"'),
      (text: string) => text.replace('"dark"', '"light"'),
      (text: string) => text.replace('"later": [1, 2]', '"later": [1, 2, 3]'),
      (text: string) => text.replace('  "later": [1, 2]\n', ''),
      (text: string) => text.replace('"later"', '"diff.layout": "split", "later"'),
      (text: string) => text.replace('"later"', '"later": [1, 2], "later"'),
      (text: string) => text.replace('"inline"', '"inline",,'),
    ];
    for (const change of mistakes) {
      fault.change = change;
      expect(() => editSettings(COMMENTED, 'diff.layout', 'inline')).toThrow(wrong);
    }
    fault.change = undefined;
    expect(editSettings(COMMENTED, 'diff.layout', 'inline')).toContain('"inline"');
  });
});
