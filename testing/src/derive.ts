/**
 * Derived cassettes: answers GitHub can't be made to give on demand, such as a lost answer, or an
 * approval of a pull request the recording account opened, written from recorded ones. A derived
 * cassette's folder holds only what it changes, each answer in the file of the recorded one it
 * replaces, by number, and what it adds, numbered after the recorded ones; read, it's the recorded
 * cassette with those in place (`readCassette`). `./derivations.ts` lists them, and
 * `testing/scripts/derive-answers.ts` writes them.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canonicalJson,
  fileNumber,
  fixturesDir,
  isObject,
  readCassette,
  type Cassette,
  type CassetteInfo,
  type Interaction,
  type Json,
  type RecordedResponse,
} from './cassette.ts';
import { fileName } from './record.ts';
import { findSecret } from './secrets.ts';

/** A cassette written from a recorded one. */
export interface Derivation {
  /** Its name. */
  readonly name: string;
  /** The recorded cassette it's written from. */
  readonly from: string;
  /** What it shows, for its `cassette.json`. */
  readonly description: string;
  /**
   * The recorded cassette's requests and answers as this one has them: any of them changed in its
   * place, and any added after them, none left out. It's given a copy to change as it likes.
   */
  readonly derive: (recorded: Interaction[]) => Interaction[];
}

/** A file to write, by its name in the cassette's folder. */
export interface DerivedFile {
  readonly file: string;
  readonly text: string;
}

/** A cassette file's text, as the recorder writes it. */
function text(value: Json | Interaction | CassetteInfo): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The files of the cassette derived from `recorded` as `derived`: each interaction that differs
 * from the recorded one in its place, under that one's number, and each after them, numbered on.
 * Throws when `derived` leaves any out.
 */
export function derivedFiles(
  recorded: Cassette['interactions'],
  derived: readonly Interaction[],
): DerivedFile[] {
  if (derived.length < recorded.length) {
    throw new Error(`it leaves out ${recorded.length - derived.length} recorded request(s)`);
  }
  const files: DerivedFile[] = [];
  let last = 0;
  derived.forEach((interaction, index) => {
    const was = recorded[index];
    const number = was ? fileNumber(was.file) : last + 1;
    last = number;
    if (was && canonicalJson(toJson(was.interaction)) === canonicalJson(toJson(interaction))) {
      return;
    }
    files.push({ file: fileName(number, interaction.request), text: text(interaction) });
  });
  return files;
}

/**
 * Writes the cassette `derivation` makes into `fixtures`, replacing what was there, from the
 * recorded cassette there. Refuses a file that holds anything shaped like a token, before
 * anything is written. The files it wrote.
 */
export function writeDerived(derivation: Derivation, fixtures: string = fixturesDir): string[] {
  const recorded = readCassette(join(fixtures, derivation.from));
  const copy = recorded.interactions.map(({ interaction }) => clone(interaction));
  const files = derivedFiles(recorded.interactions, derivation.derive(copy));
  const info: CassetteInfo = {
    description: derivation.description,
    derived_from: derivation.from,
  };
  const all = [{ file: 'cassette.json', text: text(info) }, ...files];
  for (const { file, text: written } of all) {
    const found = findSecret(written, []);
    if (found) throw new Error(`${derivation.name}/${file} would contain ${found}`);
  }
  const dir = join(fixtures, derivation.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const { file, text: written } of all) writeFileSync(join(dir, file), written);
  return all.map(({ file }) => file);
}

function toJson(interaction: Interaction): Json {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an interaction is JSON.
  return interaction as unknown as Json;
}

function clone(interaction: Interaction): Interaction {
  return structuredClone(interaction);
}

// What derivations use.

/** Whether an interaction is the GraphQL operation `operation`. */
export function graphql(operation: string): (interaction: Interaction) => boolean {
  return (interaction) => interaction.request.operation === operation;
}

/** The one interaction of `recorded` that `matches`, by its place. Throws for none, or more. */
export function only(
  recorded: readonly Interaction[],
  matches: (interaction: Interaction) => boolean,
  what: string,
): number {
  const places = recorded.flatMap((each, index) => (matches(each) ? [index] : []));
  if (places.length !== 1) {
    throw new Error(`the recording holds ${places.length} of ${what}, where it should hold one`);
  }
  return places[0]!;
}

/** `interaction`, answered with `response` instead. */
export function answered(interaction: Interaction, response: RecordedResponse): Interaction {
  return { request: interaction.request, response };
}

/** GitHub's answer when its gateway gives up, whatever it did by then: Lo can't tell. */
export const BAD_GATEWAY: RecordedResponse = {
  status: 502,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { message: 'Server Error' },
};

/**
 * GitHub's answer to a GraphQL mutation it refused, as `interaction`'s operation: no data, and an
 * `UNPROCESSABLE` error saying `message`.
 */
export function refused(interaction: Interaction, message: string): RecordedResponse {
  const data = isObject(interaction.response.body) ? interaction.response.body['data'] : undefined;
  const [field] = isObject(data) ? Object.keys(data) : [];
  if (field === undefined) throw new Error(`${interaction.request.operation} answered no data`);
  return {
    status: 200,
    headers: interaction.response.headers,
    body: {
      data: { [field]: null },
      errors: [{ type: 'UNPROCESSABLE', path: [field], locations: [], message }],
    },
  };
}

/** The value at `path` in `json`, through objects, or nothing. */
export function at(json: Json | undefined, ...path: string[]): Json | undefined {
  let value = json;
  for (const key of path) value = isObject(value) ? value[key] : undefined;
  return value;
}
