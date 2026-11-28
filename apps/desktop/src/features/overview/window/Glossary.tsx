// The repo's definitions in a tab's overview: what each of its terms shows with them, for the
// document to draw (the definition, its tags, the one a Changed term replaces, and who it's by);
// the line under the byline that says what the pull request adds and changes, with "Go to
// glossary"; and the note under the Glossary heading when they can't be used.

import { ago, Collapse, Problem, Ticks, type ProblemAction } from '@lo/ui';
import { OverviewLine, type OverviewTerms, type TermShown } from '@lo/ui/overview';
import { useMemo, useState, type ReactNode } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { usePull, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import type { Definitions, ShownTerm, TermByline } from './definitions.ts';
import { useNow } from './hooks.ts';
import {
  definitionsLine,
  OWN_DEFINITIONS,
  problemReason,
  STORE_TITLE,
  storeReason,
} from './says.ts';
import { readAction } from './States.tsx';
import { readTermsAgain, type RepoName, type StoreFailure } from './terms.ts';

/** The command that goes to the Glossary section, from the line under the byline. */
const GO_GLOSSARY = `${keys.feature}.goGlossary`;

/**
 * What tab `tab`'s overview shows for each of its terms with the repo's definitions, `definitions`
 * (`useDefinitions`), once it shows, and the note its Glossary section has when they can't be
 * used. Who wrote a definition ages as it stays on screen.
 */
export function useOverviewTerms(
  tab: string,
  definitions: Definitions | undefined,
): OverviewTerms | undefined {
  const now = useNow(true, 60_000);
  const { terms } = definitions ?? {};
  const note = useMemo(
    () => (terms?.kind === 'unreadable' ? <StoreNote tab={tab} why={terms.why} /> : undefined),
    [tab, terms],
  );
  return useMemo(
    () => (definitions === undefined ? undefined : shownWith(definitions, now, note)),
    [definitions, now, note],
  );
}

/** What the document shows for each term of `definitions`, each worked out once, as asked for. */
function shownWith(definitions: Definitions, now: number, note: ReactNode): OverviewTerms {
  const { terms } = definitions;
  const reading = terms.kind === 'reading';
  const repository = terms.kind === 'reading' ? undefined : terms.repository;
  const known = new Map<string, TermShown | undefined>();
  return {
    of(key) {
      if (known.has(key)) return known.get(key);
      const term = definitions.of(key);
      const shown = term && shownOf(term, reading, now, repository);
      known.set(key, shown);
      return shown;
    },
    note,
  };
}

/**
 * What the document shows for `term`: its definition, tags and the one it replaces, and who it's
 * by, or, while the repo's definitions are still being read, a wait in its byline's place.
 */
export function shownOf(
  term: ShownTerm,
  reading: boolean,
  now: number,
  repository: RepoName | undefined,
): TermShown {
  const { stored } = term;
  return {
    source: term.source,
    name: term.name,
    blocks: term.blocks,
    marks: {
      mark: term.tag,
      locked: stored?.locked !== undefined,
      suggestions: stored?.suggestions.length ?? 0,
    },
    before: term.before?.blocks,
    byline: reading ? { reading: true } : term.byline && bylineFacts(term.byline, now, repository),
  };
}

/** Who wrote a definition, as its byline says it: "ravi-k · agent-written · #264 · 3 d ago". */
function bylineFacts(byline: TermByline, now: number, repository: RepoName | undefined) {
  const { by, written, from, at } = byline;
  return {
    by: 'login' in by ? { login: by.login } : { name: by.name },
    written,
    pull:
      typeof from === 'number'
        ? { number: from, onOpen: repository && (() => openPull(repository, from)) }
        : undefined,
    when: ago(Date.parse(at), now),
  };
}

/** Opens pull request `number` of the repo the definitions are in, in its tab. */
function openPull(repository: RepoName, number: number): void {
  client(tabContract)
    .open({ kind: 'pull', owner: repository.owner, repo: repository.name, number })
    .catch((error: unknown) => console.error(`Lo couldn’t open #${number}:`, error));
}

/**
 * The line under the byline of an overview whose glossary adds or changes terms: what it adds and
 * changes, what it added and changed once merged, or would have, closed, and "Go to glossary". It
 * comes and goes as the repo's definitions make a term new or changed, or none.
 */
export function DefinitionsLine({
  tab,
  definitions,
}: {
  tab: PullTab;
  definitions: Definitions | undefined;
}) {
  // Until GitHub has said what state the pull request is in, it's taken as open.
  const state = usePull(tab.id)?.header?.state ?? 'open';
  const fact = definitions && definitionsLine(definitions.added, definitions.changed, state);
  return (
    <Collapse open={fact !== undefined}>
      {fact !== undefined && (
        <div className="pt-8">
          <OverviewLine icon="book-a" action={{ command: GO_GLOSSARY }}>
            {fact}
          </OverviewLine>
        </div>
      )}
    </Collapse>
  );
}

/**
 * Why the repo's definitions can't be used, under the Glossary heading: the cause, and that each
 * definition shown is the overview's own. Try again reads them again where that could help.
 */
function StoreNote({ tab, why }: { tab: string; why: StoreFailure }) {
  const [trying, setTrying] = useState(false);
  const tryAgain: ProblemAction = {
    label: 'Try again',
    busy: trying,
    working: 'Trying…',
    onClick: () => {
      setTrying(true);
      readTermsAgain(tab)
        .catch((error: unknown) => console.error("Lo couldn't read the definitions again:", error))
        .finally(() => setTrying(false));
    },
  };
  if (why.kind === 'problem') {
    const { problem } = why;
    const details =
      problem.kind === 'blocked' || problem.kind === 'failed' || problem.kind === 'offline'
        ? withoutBidi(problem.message)
        : undefined;
    return (
      <Problem
        layout="inline"
        tone="warn"
        title={STORE_TITLE}
        reason={<Reason cause={problemReason(problem).cause} />}
        action={readAction(problem, tryAgain)}
        details={details === '' ? undefined : details}
      />
    );
  }
  const { cause, details, again } = storeReason(why);
  return (
    <Problem
      layout="inline"
      tone="warn"
      title={STORE_TITLE}
      reason={<Reason cause={cause} />}
      action={again ? tryAgain : undefined}
      details={details === undefined ? undefined : withoutBidi(details)}
    />
  );
}

/** The cause, a file's name in it as code, then that each definition is the overview's own. */
function Reason({ cause }: { cause: string }) {
  return (
    <>
      {cause !== '' && (
        <>
          <Ticks text={cause} />{' '}
        </>
      )}
      {OWN_DEFINITIONS}
    </>
  );
}
