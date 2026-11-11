/**
 * What a commit's `.gitattributes` files say about its paths. Lo applies no attributes when it
 * diffs or checks out, but some are worth reading: `linguist-generated` says a file is generated,
 * so its diff starts collapsed, as on GitHub.
 */

import { GitError } from './errors.ts';
import { splitRecords } from './records.ts';
import { checkPaths } from './tree.ts';

/** The most `.gitattributes` files Lo reads for one question. */
export const MAX_ATTRIBUTE_FILES = 200;

/**
 * One attribute's state for one path, as `git check-attr` reports it: no line mentions it
 * (`unspecified`), `name` (`set`), `-name` (`unset`), or `name=value`.
 */
export type Attribute = 'unspecified' | 'set' | 'unset' | { readonly value: string };

/**
 * The attribute read as GitHub's Linguist reads its own: unset or `false` is false, set or any
 * other value is true, and no mention is `undefined`.
 */
export function linguistBoolean(attribute: Attribute): boolean | undefined {
  if (attribute === 'unspecified') return undefined;
  if (attribute === 'unset') return false;
  if (attribute === 'set') return true;
  return attribute.value !== 'false';
}

function parseValue(value: Buffer): Attribute {
  const text = value.toString('utf8');
  if (text === 'unspecified' || text === 'set' || text === 'unset') return text;
  return { value: text };
}

/** Refuses an attribute name, or a path, that git would misread. */
export function checkAttributeQuestion(name: string, paths: readonly Uint8Array[]): void {
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(name)) {
    throw new GitError({ kind: 'invalid', what: 'attribute name', value: name });
  }
  checkPaths(paths);
}

/**
 * The `.gitattributes` files that could apply to `paths`: the top one, and one in each folder a
 * path is in or under, each once, in order.
 */
export function attributeFiles(paths: readonly Uint8Array[]): Buffer[] {
  const seen = new Set<string>(['']);
  const folders = [''];
  for (const path of paths) {
    const bytes = Buffer.from(path.buffer, path.byteOffset, path.byteLength);
    for (let end = bytes.indexOf(0x2f); end !== -1; end = bytes.indexOf(0x2f, end + 1)) {
      const folder = bytes.subarray(0, end).toString('latin1');
      if (!seen.has(folder)) {
        seen.add(folder);
        folders.push(folder);
      }
    }
  }
  return folders.map((folder) =>
    Buffer.from(folder === '' ? '.gitattributes' : `${folder}/.gitattributes`, 'latin1'),
  );
}

/** The folder of a `.gitattributes` file's path: `''` for the top one. Keyed a byte a character. */
export function attributeFolder(file: Uint8Array): string {
  const text = Buffer.from(file.buffer, file.byteOffset, file.byteLength).toString('latin1');
  return text === '.gitattributes' ? '' : text.slice(0, -'/.gitattributes'.length);
}

/**
 * Whether the `.gitattributes` files of `path`'s folders are all there: none of `lacking`, the
 * folders whose file the clone lacks, is `path`'s folder or one above it.
 */
export function answerable(path: Uint8Array, lacking: ReadonlySet<string>): boolean {
  if (lacking.has('')) return false;
  const bytes = Buffer.from(path.buffer, path.byteOffset, path.byteLength);
  for (let end = bytes.indexOf(0x2f); end !== -1; end = bytes.indexOf(0x2f, end + 1)) {
    if (lacking.has(bytes.subarray(0, end).toString('latin1'))) return false;
  }
  return true;
}

/**
 * Reads `git check-attr -z` output: `<path> NUL <attribute> NUL <value> NUL` for each path, in
 * the order asked. `undefined` when it doesn't answer exactly `paths`.
 */
export function parseCheckAttr(
  output: Uint8Array,
  name: string,
  paths: readonly Uint8Array[],
): Attribute[] | undefined {
  const bytes = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  if (bytes.length === 0 || bytes.at(-1) !== 0) return undefined;
  const fields = splitRecords(bytes);
  if (fields.length !== paths.length * 3) return undefined;
  const values: Attribute[] = [];
  for (const [index, path] of paths.entries()) {
    const [found, attribute, value] = fields.slice(index * 3, index * 3 + 3);
    if (found === undefined || attribute === undefined || value === undefined) return undefined;
    if (!found.equals(path) || attribute.toString('latin1') !== name) return undefined;
    values.push(parseValue(value));
  }
  return values;
}
