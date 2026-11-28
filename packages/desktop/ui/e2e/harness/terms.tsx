// The page the terms spec reads: a term's card, its rows in a glossary, an overview's section heads
// and the line under its byline, a stack overview's layers and a list kept per repo, each in a box
// the size of where it sits in the window, a narrow one beside it, and in both themes. Their buttons
// are commands, from a registry of the engine's test commands.

import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { sections, terms, testCommands } from '../../test/commands.ts';
import { holdRegistry } from '../../src/commands/control.ts';
import { Registry } from '../../src/commands/registry.ts';
import type { RowTarget } from '../../src/commands/targets.ts';
import { OverviewLine } from '../../src/overview/OverviewLine.tsx';
import { SectionHead } from '../../src/overview/SectionHead.tsx';
import { StackLayers, type StackLayer } from '../../src/overview/StackLayers.tsx';
import { TermByline } from '../../src/overview/TermByline.tsx';
import { TermCard } from '../../src/overview/TermCard.tsx';
import { TermRow, type TermDetails } from '../../src/overview/TermRow.tsx';
import { ScopedList } from '../../src/ScopedList.tsx';
import { SettingsList } from '../../src/Settings.tsx';
import { TooltipGroup } from '../../src/Tooltip.tsx';

const BUCKET: RowTarget = { kind: 'row', row: 'bucket' };

holdRegistry(
  new Registry({
    system: 'mac',
    commands: testCommands([], [terms, sections]).map((command) =>
      // The bucket's row is expanded, and its chevron collapses it.
      command.id === 'terms.expand' && command.handler !== undefined
        ? {
            ...command,
            handler: {
              ...command.handler,
              labelled: (target) =>
                target.kind === 'row' && target.row === 'bucket' ? 'Collapse term' : undefined,
            },
          }
        : // Push access is what Edit needs, and the refill's term has none.
          command.id === 'terms.edit' && command.handler !== undefined
          ? {
              ...command,
              handler: {
                ...command.handler,
                enabled: (target) =>
                  target.kind === 'row' && target.row === 'refill'
                    ? 'You can’t push to rozed-dev/e2e.'
                    : true,
              },
            }
          : command,
    ),
  }),
);

/** A box of `width` px, named for the spec, on the ground what it holds sits on. */
function Box({
  name,
  width,
  ground = 'bg-bg',
  children,
}: {
  name: string;
  width: number;
  ground?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-box={name}
      className={`flex flex-col rounded-md border border-border-subtle ${ground}`}
      style={{ width: `${width}px` }}
    >
      {children}
    </div>
  );
}

const ravi = (when: string, pull?: number) => (
  <TermByline
    by={{ login: 'ravi-k' }}
    written="agent"
    pull={pull === undefined ? undefined : { number: pull }}
    when={when}
  />
);

const DETAILS: TermDetails = {
  byline: ravi('3 d ago', 264),
  locked: { by: 'elle-kzn', when: '2 d ago' },
  aliases: ['buckets', 'token bucket'],
  suggestions: [
    {
      key: 's1',
      definition: 'A pool of tokens per tenant that refills on a timer, not on each request.',
      byline: ravi('1 h ago', 271),
      accept: { command: 'terms.accept', target: BUCKET },
      dismiss: { command: 'terms.dismiss', target: BUCKET },
    },
    {
      key: 's2',
      definition: 'What a tenant spends a token from on each request.',
      byline: (
        <TermByline by={{ name: 'Ravi K' }} written="agent" pull={{ number: 268 }} when="5 h ago" />
      ),
      accept: { command: 'terms.accept', target: BUCKET },
      dismiss: { command: 'terms.dismiss', target: BUCKET },
      busy: 'dismiss',
    },
  ],
  earlier: Array.from({ length: 17 }, (_, at) => ({
    key: `e${at}`,
    definition:
      at === 0
        ? 'A queue of requests waiting for a slot.'
        : `An earlier definition, ${at + 1} back.`,
    byline: ravi(`${(at + 1) * 3} d ago`, 200 - at),
  })),
  capped: true,
};

/** What a row's chevron runs: Expand term, on the row. */
function expand(row: string) {
  return { command: 'terms.expand', target: { kind: 'row', row } as const };
}

/** A glossary's rows: marked terms first, then the rest, then one the reader ignores. */
function Rows({ narrow = false }: { narrow?: boolean }) {
  return (
    <div data-rows="">
      <TermRow
        data-term="token"
        term="token"
        marks={{ mark: 'new' }}
        definition="One request’s worth of a bucket."
        expand={expand('token')}
        menu
        stop
      />
      <TermRow
        data-term="refill"
        term="refill"
        marks={{ mark: 'changed' }}
        definition="Tokens added back to a bucket on a timer, up to its size."
        before="Tokens added back to a bucket after each request."
        expand={expand('refill')}
        menu
        stop
        focused
      />
      <TermRow
        data-term="bucket"
        term="bucket"
        marks={{ locked: true, suggestions: 2 }}
        definition="A pool of tokens per tenant, which the limiter takes one from for each request."
        expand={expand('bucket')}
        expanded={!narrow}
        details={DETAILS}
        menu
        stop
      />
      <TermRow
        data-term="long"
        term="per-tenant-request-admission-controller"
        definition="What decides whether a request goes on or waits."
        expand={expand('long')}
        menu
        stop
      />
      <TermRow
        data-term="ignored"
        term="limiter"
        definition="What hands out tokens."
        menu
        ignored
        reached={narrow}
        focused={narrow}
      />
    </div>
  );
}

const LAYERS: StackLayer[] = [
  {
    key: '81',
    number: 81,
    title: 'Add the token bucket',
    state: 'merged',
    summary: {
      kind: 'tldr',
      text: 'Requests now wait for a token from their tenant’s bucket. A bucket holds 50 and refills at 10 a second, so a burst of 50 passes and the rest wait for the refill.',
    },
  },
  {
    key: '82',
    number: 82,
    title: 'Refill buckets on a timer',
    state: 'open',
    review: 'approved',
    summary: {
      kind: 'description',
      text: 'Moves the refill off the request path and onto a timer per tenant.',
    },
  },
  {
    key: '83',
    number: 83,
    title: 'Expose bucket metrics',
    state: 'draft',
    summary: { kind: 'none' },
  },
  {
    key: '84',
    number: 84,
    title: 'Docs for limits',
    state: 'open',
    review: 'required',
    sitsOn: 82,
    summary: { kind: 'reading' },
  },
  {
    key: '85',
    number: 85,
    title: 'Per-key overrides for internal tools',
    state: 'open',
    review: 'changes',
    sitsOn: 82,
    summary: { kind: 'description', text: 'Internal tools get their own bucket size.' },
  },
];

/** A word longer than any column it's in: a path, as a definition may hold one. */
const LONG =
  'packages/desktop/ui/src/overview/limits/per-tenant-request-admission-controller/token-bucket-refill-timer.ts';

/** A card, a row and a layer holding words longer than their columns, which break to fit. */
function Long() {
  return (
    <>
      <TermCard
        term={LONG}
        definition={`Lives in ${LONG}, which the limiter reads.`}
        before={LONG}
        byline={{ by: { login: 'ravi-k' }, written: 'agent', when: 'now' }}
      />
      <div data-rows="">
        <TermRow
          data-term="long-word"
          term="refill"
          definition={`Lives in ${LONG}.`}
          before={LONG}
          expand={expand('long-word')}
          expanded
          details={{
            aliases: [LONG, 'refills'],
            suggestions: [{ key: 's', definition: LONG, byline: ravi('now') }],
            earlier: [{ key: 'e', definition: LONG, byline: ravi('now') }],
          }}
        />
      </div>
      <StackLayers
        layers={[
          {
            key: '90',
            number: 90,
            title: LONG,
            state: 'open',
            review: 'required',
            summary: { kind: 'tldr', text: LONG },
          },
        ]}
      />
    </>
  );
}

function Sheet() {
  return (
    <div className="flex flex-wrap items-start gap-24 bg-bg-chrome p-24 text-fg">
      <Box name="card-full" width={320} ground="bg-bg-chrome">
        <TermCard
          term="bucket"
          marks={{ mark: 'changed', locked: true }}
          definition="A pool of tokens per tenant, which the limiter takes one from for each request."
          before="A queue of requests waiting for a slot."
          byline={{
            by: { login: 'ravi-k' },
            written: 'agent',
            pull: { number: 264 },
            when: '3 d ago',
          }}
          suggestions={{ count: 2, command: 'terms.history', target: BUCKET }}
          hints={[
            { command: 'terms.edit', target: BUCKET, label: 'Edit…' },
            { command: 'terms.history', target: BUCKET, label: 'History' },
          ]}
          keys
          menu
        />
      </Box>
      <Box name="card-plain" width={320} ground="bg-bg-chrome">
        <TermCard term="token" definition="One request’s worth of a bucket." more />
      </Box>
      <Box name="card-git" width={320} ground="bg-bg-chrome">
        <TermCard
          term="refill"
          marks={{ mark: 'new' }}
          definition="Tokens added back to a bucket on a timer, up to its size."
          byline={{
            by: { name: '"Ravi Kumar" <ravi@example.com> · maintainer' },
            written: 'agent',
            pull: { number: 268 },
            when: '5 h ago',
          }}
          hints={[
            { command: 'terms.edit', target: { kind: 'row', row: 'refill' }, label: 'Edit…' },
          ]}
          menu
        />
      </Box>
      <Box name="card-reading" width={320} ground="bg-bg-chrome">
        <TermCard term="limiter" definition="What hands out tokens." byline={{ reading: true }} />
      </Box>
      <Box name="article" width={760}>
        <article className="lo-ov__article lo-prose pb-24">
          <div data-lines="">
            <OverviewLine icon="book-a" action={{ command: 'sections.glossary' }}>
              Adds 2 definitions · changes 1
            </OverviewLine>
            <OverviewLine icon="layers" action={{ command: 'sections.stack' }}>
              Part of a 4-layer stack
            </OverviewLine>
          </div>
          <SectionHead name="tl;dr" open>
            tl;dr
          </SectionHead>
          <p>A bucket holds tokens, which the limiter takes one of for each request.</p>
          <SectionHead
            name="Why"
            open={false}
            fold={{ command: 'sections.fold', target: { kind: 'block', block: 'why' } }}
            menu
          >
            Why
          </SectionHead>
          <SectionHead
            name="Glossary"
            open
            fold={{ command: 'sections.fold', target: { kind: 'block', block: 'glossary' } }}
            menu
          >
            Glossary
          </SectionHead>
          <Rows />
        </article>
      </Box>
      <div className="flex flex-col gap-24">
        <Box name="rows-narrow" width={400}>
          <div className="px-12 py-8">
            <Rows narrow />
          </div>
        </Box>
        <Box name="layers-narrow" width={400}>
          <div className="p-12">
            <StackLayers layers={LAYERS} current="82" />
          </div>
        </Box>
      </div>
      <Box name="layers" width={760}>
        <article className="lo-ov__article lo-prose">
          <SectionHead
            name="Layers"
            open
            fold={{ command: 'sections.fold', target: { kind: 'block', block: 'layers' } }}
          >
            Layers
          </SectionHead>
          <StackLayers layers={LAYERS} current="82" />
        </article>
      </Box>
      <Box name="long" width={640}>
        <div className="flex flex-col gap-24 p-12">
          <Long />
        </div>
      </Box>
      <Box name="scoped" width={640}>
        <div className="px-24 py-12">
          <SettingsList label="Collapsed sections">
            <ScopedList
              kind="heading"
              every={[
                { key: 'Testing', label: 'Testing' },
                { key: 'Risks', label: 'Risks' },
              ]}
              repos={[
                {
                  repo: 'rozed-dev/e2e',
                  entries: [
                    { key: 'Testing', label: 'Testing', everywhere: true },
                    { key: 'Why', label: 'Why' },
                  ],
                },
                { repo: 'rozed-dev/api', entries: [] },
              ]}
            />
          </SettingsList>
        </div>
      </Box>
      <Box name="scoped-narrow" width={400}>
        <div className="px-12 py-12">
          <SettingsList label="Ignored terms">
            <ScopedList
              kind="term"
              every={[]}
              repos={[
                {
                  repo: 'rozed-dev/e2e',
                  entries: [
                    { key: 'bucket', label: 'bucket' },
                    { key: 'limiter', label: 'limiter', everywhere: true },
                  ],
                },
              ]}
            />
          </SettingsList>
        </div>
      </Box>
      <Box name="scoped-empty" width={400}>
        <div className="px-12 py-12">
          <SettingsList label="Ignored terms">
            <ScopedList kind="term" every={[]} />
          </SettingsList>
        </div>
      </Box>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <TooltipGroup>
    <div data-sheet="dark">
      <Sheet />
    </div>
    <div data-sheet="light" data-theme="light" data-drawn>
      <Sheet />
    </div>
  </TooltipGroup>,
);
