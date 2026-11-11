// Settings, in its tab: the list of sections beside the sections every feature put in the
// `settings.sections` slot, and what is wrong with the settings file above them.

import { SettingsPage, SettingsSection } from '@lo/ui';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';

import { setMiddle } from '../../../window/commands/registry.ts';
import { useViews } from '../../../window/slots.tsx';
import { onMoveSection } from './nav.ts';
import { sectionInfo } from './sections.ts';
import { sections, useProblems, useSettingsFile } from './shared.ts';

/** What is wrong in the settings file, above the sections, where the person who edited it looks. */
function Problems() {
  const problems = useProblems();
  const file = useSettingsFile();
  if (problems.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex w-full max-w-settings-w flex-none flex-col gap-4 rounded-md border border-danger-border bg-danger-bg px-12 py-8 text-ui"
    >
      <span className="font-semibold">
        {problems.length === 1
          ? 'Lo found a problem in the settings file'
          : `Lo found ${problems.length} problems in the settings file`}
        {file !== undefined && (
          <>
            {' '}
            <span className="break-all code-small">{file}</span>
          </>
        )}
        :
      </span>
      <ul className="m-0 flex flex-col gap-2 ps-16">
        {problems.map(({ key, message }) => (
          <li key={`${key ?? ''} ${message}`}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

/** Whether the body is scrolled as far down as it goes, having scrolled at all. */
function atEnd(body: HTMLElement): boolean {
  return body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
}

/** The section whose top is the last at or above the top of the body, or the last at the end. */
function sectionOnScreen(body: HTMLElement): string | undefined {
  const all = [...body.querySelectorAll<HTMLElement>('[data-settings-section]')];
  const top = body.getBoundingClientRect().top;
  let found = all[0];
  for (const section of all) {
    if (section.getBoundingClientRect().top - top <= 1) found = section;
  }
  if (atEnd(body)) found = all.at(-1);
  return found?.dataset.settingsSection;
}

/** Settings, the page of the tab of that kind. */
export function SettingsTab() {
  const views = useViews(sections);
  const file = useSettingsFile();
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string>();
  /**
   * The section last gone to by the list or a key, which stays the one on screen while the body
   * can't scroll its top up to the top, as near the end, until the person scrolls back up.
   */
  const chosen = useRef<string>(undefined);
  const items = views.map(({ id }) => ({ id, label: sectionInfo.get(id)?.title ?? id }));
  const here = current ?? items[0]?.id;

  const go = useCallback((id: string) => {
    chosen.current = id;
    setCurrent(id);
    body.current
      ?.querySelector(`[data-settings-section="${id}"]`)
      ?.scrollIntoView?.({ block: 'start' });
  }, []);

  // `j` and `k` move between sections, from the one on screen.
  const ids = items.map(({ id }) => id).join(' ');
  useEffect(() => {
    const order = ids === '' ? [] : ids.split(' ');
    return onMoveSection((step) => {
      const at = Math.max(0, order.indexOf(current ?? order[0] ?? ''));
      const next = order[Math.min(order.length - 1, Math.max(0, at + step))];
      if (next !== undefined) go(next);
    });
  }, [ids, current, go]);

  // Settings is the middle of the window, so `Esc` brings focus here. So does opening it, when
  // focus was nowhere in particular: on the window, or on the middle itself, which `Esc` leaves it
  // on while no view is there. Focus in a field or on a control stays where it is.
  useEffect(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) {
      root.current?.focus();
    }
    return setMiddle({
      focus: () => root.current?.focus(),
      here: () => undefined,
    });
  }, []);

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="settings"
      data-lo-tab="browser"
      className="flex min-h-0 flex-1 flex-col focus-visible:shadow-none"
    >
      <SettingsPage
        items={items}
        current={here}
        onGo={go}
        bodyRef={body}
        onBodyScroll={(event) => {
          const scrolled = event.currentTarget;
          if (chosen.current !== undefined && atEnd(scrolled)) return;
          chosen.current = undefined;
          setCurrent(sectionOnScreen(scrolled));
        }}
        footer={
          file === undefined ? undefined : (
            <>
              Settings live in{' '}
              <span className="break-all code-small">
                {file.slice(0, file.lastIndexOf('/') + 1)}
              </span>
            </>
          )
        }
      >
        <Problems />
        {views.map((view) => {
          const info = sectionInfo.get(view.id);
          return (
            <SettingsSection
              key={view.id}
              id={view.id}
              title={info?.title ?? view.id}
              description={info?.description}
            >
              {createElement(view.render, {})}
            </SettingsSection>
          );
        })}
      </SettingsPage>
    </div>
  );
}
