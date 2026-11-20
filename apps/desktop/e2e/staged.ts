// A cassette served a stage at a time, a stage ending with each write a test names: until Lo sends
// the next write, each request gets the answers recorded before it, the last repeating, and once
// it's sent, those recorded after. However many polls come between, a read never gets an answer
// from past a write Lo hasn't sent yet, nor one from before a write it has. With `sooner`, a read
// first recorded after a write, which Lo may make sooner than the recording did, gets the first
// answer recorded for it until then; a write never does.

import {
  cassette as recorded,
  type Interaction,
  isWrite,
  recordedKey,
  Replay,
  ReplayError,
  type SeenRequest,
} from '@lo/testing';

/** A request, as recorded or as Lo sent it: its method, its address and its GraphQL operation. */
export interface Asked {
  readonly method: string;
  readonly url: string;
  readonly operation: string | undefined;
}

/** The GraphQL operation a request names, if it names one. */
function operationOf(request: SeenRequest): string | undefined {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/graphql') return undefined;
  const body: unknown = JSON.parse(new TextDecoder().decode(request.body));
  const name =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'operationName') : undefined;
  return typeof name === 'string' ? name : undefined;
}

/** How a cassette is served a stage at a time. */
export interface Staging {
  /** Answers from elsewhere, from the start. */
  readonly first?: readonly Interaction[];
  /** Whether a read first recorded after a write gets its first answer from before it. */
  readonly sooner?: boolean;
}

export class Staged extends Replay {
  readonly #stages: Replay[];
  /** For each stage with `sooner`, the first answer recorded later for each read it hasn't. */
  readonly #sooner: Replay[] | undefined;
  readonly #writes: (asked: Asked) => boolean;
  #at = 0;

  /** Serves cassette `name` a stage at a time, each ending with a request `writes` names. */
  constructor(name: string, writes: (asked: Asked) => boolean, staging: Staging = {}) {
    const { info, interactions: files } = recorded(name);
    const interactions = files.map(({ interaction }) => interaction);
    super(name, interactions);
    this.#writes = writes;
    // Answers added after the recording, which come after its writes but answer reads Lo sends
    // from the start, from the start too.
    const added = new Set(Object.keys(info.added ?? {}));
    const isAdded = ({ request }: Interaction) =>
      added.has(request.operation ?? `${request.method} ${request.url}`);
    const stages: Interaction[][] = [[...(staging.first ?? []), ...interactions.filter(isAdded)]];
    for (const each of interactions.filter((interaction) => !isAdded(interaction))) {
      stages.at(-1)!.push(each);
      const { method, url, operation } = each.request;
      if (writes({ method, url, operation })) stages.push([]);
    }
    // A request a stage has no answer for gets the last one recorded before it.
    const last = new Map<string, Interaction>();
    const known = stages.map((stage) => {
      const own = new Set(stage.map((each) => recordedKey(each.request)));
      const carried = [...last].filter(([key]) => !own.has(key)).map(([, each]) => each);
      for (const each of stage) last.set(recordedKey(each.request), each);
      return { carried, seen: new Set(last.keys()) };
    });
    this.#stages = stages.map(
      (stage, index) => new Replay(`${name}, stage ${index}`, [...known[index]!.carried, ...stage]),
    );
    if (!staging.sooner) return;
    const later = new Map<string, Interaction>();
    const sooner: Replay[] = [];
    for (let index = stages.length - 1; index >= 0; index--) {
      const { seen } = known[index]!;
      const unseen = [...later].filter(([key]) => !seen.has(key)).map(([, each]) => each);
      sooner[index] = new Replay(`${name}, sooner than stage ${index + 1}`, unseen);
      for (const each of stages[index]!.toReversed()) later.set(recordedKey(each.request), each);
    }
    this.#sooner = sooner;
  }

  override answer(request: SeenRequest): Response {
    this.seen.push(request);
    const response = this.#answerAt(request);
    const { method, url } = request;
    if (this.#writes({ method, url, operation: operationOf(request) })) {
      this.#at = Math.min(this.#at + 1, this.#stages.length - 1);
    }
    return response;
  }

  /** The stage's answer, or, for a read it has none for, with `sooner`, the first one after it. */
  #answerAt(request: SeenRequest): Response {
    try {
      return this.#stages[this.#at]!.answer(request);
    } catch (error) {
      const sooner = this.#sooner?.[this.#at];
      const { method, url, body } = request;
      if (!(error instanceof ReplayError) || !sooner || isWrite(method, new URL(url), body)) {
        throw error;
      }
      try {
        return sooner.answer(request);
      } catch {
        throw error;
      }
    }
  }
}
