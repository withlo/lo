// A cassette served a stage at a time, a stage ending with each write a test names: until Lo sends
// the next write, each request gets the answers recorded before it, the last repeating, and once
// it's sent, those recorded after. However many polls come between, a read never gets an answer
// from past a write Lo hasn't sent yet, nor one from before a write it has. A read first recorded
// after a write, which Lo may make sooner than the recording did, gets the first answer recorded
// for it until then.

import {
  cassette as recorded,
  type Interaction,
  recordedKey,
  Replay,
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

export class Staged extends Replay {
  readonly #stages: Replay[];
  readonly #writes: (asked: Asked) => boolean;
  #at = 0;

  /**
   * Serves cassette `name` a stage at a time, each ending with a request `writes` names, with
   * `first`, answers from elsewhere, from the start.
   */
  constructor(name: string, writes: (asked: Asked) => boolean, first: readonly Interaction[] = []) {
    const { info, interactions: files } = recorded(name);
    const interactions = files.map(({ interaction }) => interaction);
    super(name, interactions);
    this.#writes = writes;
    // Answers added after the recording, which come after its writes but answer reads Lo sends
    // from the start, from the start too.
    const added = new Set(Object.keys(info.added ?? {}));
    const isAdded = ({ request }: Interaction) =>
      added.has(request.operation ?? `${request.method} ${request.url}`);
    const stages: Interaction[][] = [[...first, ...interactions.filter(isAdded)]];
    for (const each of interactions.filter((interaction) => !isAdded(interaction))) {
      stages.at(-1)!.push(each);
      const { method, url, operation } = each.request;
      if (writes({ method, url, operation })) stages.push([]);
    }
    // A request a stage has no answer for gets the last one recorded before it, or, for one first
    // recorded after it, as a poll Lo makes sooner than the recording did, the first of those.
    const after = stages.map(() => new Map<string, Interaction>());
    const next = new Map<string, Interaction>();
    for (let index = stages.length - 1; index >= 0; index--) {
      for (const [key, each] of next) after[index]!.set(key, each);
      for (const each of stages[index]!.toReversed()) next.set(recordedKey(each.request), each);
    }
    const last = new Map<string, Interaction>();
    this.#stages = stages.map((stage, index) => {
      const own = new Set(stage.map((each) => recordedKey(each.request)));
      const carried = [...last].filter(([key]) => !own.has(key)).map(([, each]) => each);
      for (const each of stage) last.set(recordedKey(each.request), each);
      const sooner = [...after[index]!].filter(([key]) => !last.has(key)).map(([, each]) => each);
      return new Replay(`${name}, stage ${index}`, [...carried, ...stage, ...sooner]);
    });
  }

  override answer(request: SeenRequest): Response {
    this.seen.push(request);
    const response = this.#stages[this.#at]!.answer(request);
    const { method, url } = request;
    if (this.#writes({ method, url, operation: operationOf(request) })) {
      this.#at = Math.min(this.#at + 1, this.#stages.length - 1);
    }
    return response;
  }
}
