// @vitest-environment jsdom
// An overview section's heading, which folds it, and the quiet line under an overview's byline.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { missingRules } from '../../test/classes.ts';
import { sections, testCommands, type Ran } from '../../test/commands.ts';
import { cleanUp, click, render } from '../../test/dom.ts';
import { holdRegistry } from '../commands/control.ts';
import { Registry } from '../commands/registry.ts';
import type { BlockTarget } from '../commands/targets.ts';
import { OverviewLine } from './OverviewLine.tsx';
import { SectionHead } from './SectionHead.tsx';

const WHY: BlockTarget = { kind: 'block', block: 'why' };
const FOLD = { command: 'sections.fold', target: WHY };

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let release: (() => void) | undefined;
afterEach(() => {
  cleanUp();
  release?.();
  release = undefined;
});

function held(): Ran[] {
  const ran: Ran[] = [];
  release = holdRegistry(new Registry({ system: 'mac', commands: testCommands(ran, [sections]) }));
  return ran;
}

describe('SectionHead', () => {
  it('is the heading, with its chevron before it and its menu after', () => {
    const ran = held();
    const host = render(
      <SectionHead name="Why" id="why" tabIndex={-1} open fold={FOLD} menu controls="why-body">
        Why
      </SectionHead>,
    );
    const head = host.querySelector('.lo-section-head')!;
    expect(head.hasAttribute('data-collapsed')).toBe(false);
    const heading = head.querySelector('h2')!;
    expect(heading.id).toBe('why');
    expect(heading.textContent).toBe('Why');
    const [chevron, more] = head.querySelectorAll('button');
    expect(chevron?.getAttribute('aria-label')).toBe('Collapse section');
    expect(chevron?.getAttribute('aria-expanded')).toBe('true');
    expect(chevron?.getAttribute('aria-controls')).toBe('why-body');
    expect(more?.getAttribute('aria-label')).toBe('More actions for Why');
    // Open, its words are text to select: a click on them runs nothing.
    click(heading);
    expect(ran).toEqual([]);
    click(chevron!);
    expect(ran).toEqual([['sections.fold', WHY]]);
  });

  it('collapsed, keeps its heading, and a click on its words opens it', () => {
    const ran = held();
    const host = render(
      <SectionHead name="Why" open={false} fold={FOLD} controls="why-body">
        Why
      </SectionHead>,
    );
    const head = host.querySelector('.lo-section-head')!;
    expect(head.hasAttribute('data-collapsed')).toBe(true);
    const chevron = head.querySelector('button')!;
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.hasAttribute('aria-controls')).toBe(false);
    click(head.querySelector('h2')!);
    expect(ran).toEqual([['sections.fold', WHY]]);
  });

  it('has neither chevron nor menu on the tl;dr, which never collapses', () => {
    held();
    const host = render(
      <SectionHead name="tl;dr" open>
        tl;dr
      </SectionHead>,
    );
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[data-collapsed]')).toBeNull();
  });
});

describe('OverviewLine', () => {
  it('is one fact and the hint that goes where it points', () => {
    const ran = held();
    const host = render(
      <OverviewLine icon="book-a" action={{ command: 'sections.glossary' }}>
        Adds 2 definitions · changes 1
      </OverviewLine>,
    );
    const line = host.querySelector('[role="note"]')!;
    expect(line.textContent).toBe('Adds 2 definitions · changes 1Go to glossary');
    click(line.querySelector('button')!);
    expect(ran).toEqual([['sections.glossary', { kind: 'none' }]]);
    const stack = render(
      <OverviewLine icon="layers" action={{ command: 'sections.stack' }}>
        Part of a 4-layer stack
      </OverviewLine>,
    );
    const keys = [...stack.querySelectorAll('button kbd')].map((key) => key.textContent);
    expect(keys).toEqual(['g', 's']);
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    held();
    const head = render(
      <SectionHead name="Why" open fold={FOLD} menu>
        Why
      </SectionHead>,
    );
    const line = render(
      <OverviewLine icon="book-a" action={{ command: 'sections.glossary' }}>
        Adds 1 definition
      </OverviewLine>,
    );
    expect(await missingRules(head)).toEqual([]);
    expect(await missingRules(line)).toEqual([]);
  });
});
