// The page the code components' spec drives: each of the peek's frame, the references panel, the
// type hover, a language server's status item and Settings' trust rows, drawn in a box of the
// width and theme the spec asks for. The code inside a peek is a stand-in for what the diff view
// draws.

import { Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { markdownTree } from '@lo/markdown';

import { Peek, type PeekCandidate } from '../../src/Peek.tsx';
import { ReferencesHead, ReferencesList, type ReferencesGroup } from '../../src/References.tsx';
import { ServerStatus, type ServerState } from '../../src/ServerStatus.tsx';
import { StatusBar } from '../../src/StatusBar.tsx';
import { TrustList, type TrustEntry } from '../../src/Trust.tsx';
import { TypeHover, TypeHoverWaiting } from '../../src/TypeHover.tsx';

export type Theme = 'dark' | 'light';

/** The scenes the spec draws, by name. */
export type Scene =
  | 'peek'
  | 'peek-single'
  | 'references'
  | 'references-empty'
  | 'hover'
  | 'hover-bare'
  | 'hover-waiting'
  | 'status'
  | 'details'
  | 'trust';

const ANSWERS: PeekCandidate[] = [
  {
    key: 'estimate',
    path: 'packages/graphql/src/cost/estimate.ts',
    line: 18,
    source: { kind: 'server', name: 'TypeScript' },
  },
  {
    key: 'cost',
    path: 'ratelimit/src/cost.ts',
    line: 41,
    source: { kind: 'server', name: 'TypeScript' },
    note: 'overload',
  },
  {
    key: 'helpers',
    path: 'test/helpers/cost.ts',
    line: 7,
    source: { kind: 'syntax' },
    note: 'same name',
  },
];

const KEYS = {
  move: ['j', 'k'],
  go: ['⏎'],
  references: ['g', 'r'],
  back: ['⌃o'],
  close: ['Esc'],
};

const CODE = [
  [14, '/**'],
  [15, " * Adds up a query's cost: each field's weight, times the page size of"],
  [16, ' * every list it sits inside. Fragments count once per spread.'],
  [17, ' */'],
  [18, 'export function estimateCost('],
  [19, '  schema: GraphQLSchema,'],
  [20, '  document: DocumentNode,'],
  [21, '  options: { operationName?: string; weights: WeightTable },'],
  [22, '): CostReport {'],
] as const;

function StandInCode() {
  return (
    <div className="lo-uni" style={{ gridTemplateColumns: '52px minmax(0, 1fr)' }}>
      {CODE.map(([line, text]) => (
        <Fragment key={line}>
          <div className="lo-ln">{line}</div>
          <div className="lo-line">{text}</div>
        </Fragment>
      ))}
    </div>
  );
}

function row(key: string, line: number, text: string) {
  const from = text.indexOf('RateLimitedError');
  return { key, line, text, match: { from, to: from + 'RateLimitedError'.length } };
}

const REFERENCES: ReferencesGroup[] = [
  {
    key: 'errors',
    path: 'graphql/errors.ts',
    rows: [
      row('e12', 12, 'export class RateLimitedError extends GraphQLError {'),
      row('e48', 48, '    if (error instanceof RateLimitedError) {'),
    ],
  },
  {
    key: 'rate-limit',
    path: 'graphql/plugins/rate-limit.ts',
    rows: [
      row('r3', 3, 'import { RateLimitedError } from "../errors";'),
      row('r36', 36, '            throw new RateLimitedError({ reason: "QUERY_TOO_EXPENSIVE" });'),
      row(
        'r90',
        90,
        `            const message = "${'a long line of text that runs on '.repeat(3)}"; throw new RateLimitedError();`,
      ),
    ],
  },
  {
    key: 'tests',
    path: 'packages/ratelimit/test/integration/graphql/rate-limit.test.ts',
    rows: [row('t9', 9, 'import { RateLimitedError } from "../../../src/graphql/errors";')],
  },
];

const DOCS = markdownTree(
  [
    "What `estimateCost` found: the query's total cost and each field's share, in visit order.",
    "`ceilingHit` is true when one list's page size alone passed the ceiling.",
    '',
    '![A chart of the cost](https://user-images.githubusercontent.com/1/chart.png)',
    '',
    'See [the limits](https://example.com/limits).',
  ].join('\n\n'),
);

const SIGNATURE = (
  <>
    <span className="lo-syn-keyword">const</span> report:{' '}
    <span className="lo-syn-type">CostReport</span>
    {'\n'}
    <span className="lo-syn-keyword">type</span> <span className="lo-syn-type">CostReport</span> ={' '}
    {'{'}
    {'\n  '}total: <span className="lo-syn-type">number</span>;{'\n  '}fields:{' '}
    <span className="lo-syn-type">FieldCost</span>[];{'\n  '}ceilingHit:{' '}
    <span className="lo-syn-type">boolean</span>;{'\n'}
    {'}'}
  </>
);

const ENTRIES: TrustEntry[] = [
  { key: 'api', name: 'fieldwork/atlas-api', kind: 'repo', trusted: '12 days ago' },
  { key: 'web', name: 'fieldwork/atlas-web', kind: 'repo', trusted: '3 days ago' },
  { key: 'fork', name: 'sam-whit/atlas-api#4833', kind: 'fork', trusted: 'today' },
];

const STATES: { name: string; state: ServerState }[] = [
  { name: 'TypeScript', state: { kind: 'downloading', done: 12_000_000, total: 40_000_000 } },
  { name: 'Python', state: { kind: 'indexing', percent: 40 } },
  {
    name: 'Java',
    state: { kind: 'failed', why: { kind: 'memory', limit: '4 GB', files: 3880 } },
  },
  { name: 'Go', state: { kind: 'missing', needs: 'Go 1.24 or later', install: 'brew install go' } },
];

function sceneNode(scene: Scene, container: HTMLElement): ReactNode {
  switch (scene) {
    case 'peek':
      return (
        <Peek
          name="estimateCost"
          candidates={ANSWERS}
          selected="estimate"
          at="r5"
          meta="src/graphql/cost/estimate.ts · r5 · added in this PR"
          keys={KEYS}
          className="m-12"
        >
          <StandInCode />
        </Peek>
      );
    case 'peek-single':
      return (
        <Peek
          name="estimateCost"
          candidates={ANSWERS.slice(0, 1)}
          selected="estimate"
          at="r5"
          meta="src/graphql/cost/estimate.ts · r5"
          keys={KEYS}
          className="m-12"
        >
          <StandInCode />
        </Peek>
      );
    case 'references':
      return (
        <div className="flex h-full flex-col bg-bg-chrome pt-12">
          <ReferencesHead
            name="RateLimitedError"
            count={7}
            files={3}
            source={{ kind: 'server', name: 'TypeScript' }}
            at="r5"
          />
          <ReferencesList groups={REFERENCES} current="r3" focused="r36" />
        </div>
      );
    case 'references-empty':
      return (
        <div className="flex h-full flex-col bg-bg-chrome pt-12">
          <ReferencesList groups={[]} empty="No references of RateLimitedError found." />
        </div>
      );
    case 'hover':
      return (
        <TypeHover
          signature={SIGNATURE}
          docs={DOCS}
          source={{ kind: 'server', name: 'TypeScript' }}
          keys={{ definition: ['g', 'd'], close: ['Esc'] }}
          className="m-12"
        />
      );
    case 'hover-bare':
      return (
        <TypeHover
          signature="(method) TokenBucket.take(points: number): boolean"
          source={{ kind: 'server', name: 'TypeScript' }}
          location={{ path: 'packages/ratelimit/src/bucket.ts', line: 52 }}
          keys={{ definition: ['g', 'd'], close: ['Esc'] }}
          className="m-12"
        />
      );
    case 'hover-waiting':
      return (
        <TypeHoverWaiting
          server="TypeScript"
          known={{ name: 'take', kind: 'method' }}
          className="m-12"
        />
      );
    case 'status':
      return (
        <StatusBar
          start={STATES.map(({ name, state }) => (
            <ServerStatus
              key={name}
              name={name}
              state={state}
              onRestart={() => undefined}
              onShowLog={() => undefined}
              container={container}
            />
          ))}
        />
      );
    case 'details':
      return (
        <div className="relative h-full">
          <div className="absolute inset-x-0 bottom-0">
            <StatusBar
              start={
                <ServerStatus
                  name="TypeScript"
                  state={{ kind: 'failed', why: { kind: 'memory', limit: '4 GB', files: 3880 } }}
                  version="tsserver 5.6.3"
                  open
                  onRestart={() => undefined}
                  onShowLog={() => undefined}
                  container={container}
                />
              }
            />
          </div>
        </div>
      );
    case 'trust':
      return (
        <div className="bg-bg p-24">
          <TrustList entries={ENTRIES} onRemove={() => undefined} />
        </div>
      );
    default:
      scene satisfies never;
      throw new Error(`A scene the page doesn't have: ${JSON.stringify(scene)}.`);
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');
const react = createRoot(root);

/** Draws `scene` in a box `width` wide and `height` tall, in `theme`. */
function show(scene: Scene, theme: Theme, width: number, height = 360): void {
  root!.dataset['theme'] = theme;
  root!.style.width = `${width}px`;
  root!.style.height = `${height}px`;
  root!.style.position = 'relative';
  react.render(sceneNode(scene, root!));
}

Object.assign(window, { harness: { show } });

declare global {
  interface Window {
    harness: { show: typeof show };
  }
}
