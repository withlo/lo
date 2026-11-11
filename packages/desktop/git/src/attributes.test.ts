import { expect, test } from 'vitest';

import { linguistBoolean, parseCheckAttr } from './attributes.ts';

test('values read as linguist reads them', () => {
  expect(linguistBoolean('set')).toBe(true);
  expect(linguistBoolean({ value: 'true' })).toBe(true);
  expect(linguistBoolean('unset')).toBe(false);
  expect(linguistBoolean({ value: 'false' })).toBe(false);
  expect(linguistBoolean({ value: '1' })).toBe(true);
  expect(linguistBoolean({ value: 'maybe' })).toBe(true);
  expect(linguistBoolean('unspecified')).toBeUndefined();
});

test('output is read in the order asked', () => {
  const paths = ['a.pb.go', 'Cargo.lock', 'odd\nname'].map((path) => Buffer.from(path));
  const output = Buffer.from('a.pb.go\0gen\0set\0Cargo.lock\0gen\0unset\0odd\nname\0gen\0maybe\0');

  expect(parseCheckAttr(output, 'gen', paths)).toEqual(['set', 'unset', { value: 'maybe' }]);
});

test('output that doesnt answer each path is refused', () => {
  const paths = [Buffer.from('a'), Buffer.from('b')];
  // Too few, too many, another path, another attribute, cut short.
  for (const output of [
    'a\0gen\0set\0',
    'a\0gen\0set\0b\0gen\0set\0c\0gen\0set\0',
    'a\0gen\0set\0c\0gen\0set\0',
    'a\0gen\0set\0b\0other\0set\0',
    'a\0gen\0set\0b\0gen',
  ]) {
    expect.soft(parseCheckAttr(Buffer.from(output), 'gen', paths)).toBeUndefined();
  }
});
