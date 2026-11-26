// The welcome's second step: how Lo looks, chosen by looking. Each setting is a group of cards, a
// picture of each option over its name, named by the setting's own label, with its place in
// Settings at the end of the label's row. A press writes the setting at once, and the window
// follows it, so Continue writes nothing.

import {
  Choices,
  Collapse,
  LayoutPicture,
  ThemePicture,
  ThreadsPicture,
  type ChoiceItem,
} from '@lo/ui';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { threadsChoice } from '../../comments/window/shared.ts';
import { layoutChoice } from '../../diff/window/shared.ts';
import { themeChoice, useChoice, type SettingChoice } from '../../settings/window/shared.ts';
import { choose } from './actions.ts';
import { StepHeading } from './Heading.tsx';
import { welcomeStore } from './store.ts';

/**
 * A setting's group of cards: its label and its place in Settings, then a card for each option,
 * with `picture` drawing what it looks like, and its line where the feature gave it one. It shows
 * the card last pressed while the setting is being written, then what's on file, and under it the
 * `Problem` its row in Settings shows when the file refused it.
 */
function Group<T extends string>({
  choice,
  picture,
  first = false,
}: {
  choice: SettingChoice<T>;
  picture: (value: T) => ReactNode;
  /** The step's first group, whose chosen card focus starts on. */
  first?: boolean;
}) {
  const { value, onFile, change, problem } = useChoice(choice);
  const pressed = useStore(welcomeStore, (state) => state.choosing[choice.key]);
  const shown = choice.options.find((option) => option.value === pressed)?.value ?? value;
  const items: ChoiceItem<T>[] = choice.options.map((option) => ({
    value: option.value,
    title: option.label,
    picture: picture(option.value),
    ...(option.description === undefined ? {} : { description: option.description }),
  }));
  return (
    <div>
      <div
        className="flex flex-col gap-8"
        // The step starts on this group's chosen card, the one `Tab` reaches, so the arrows choose
        // at once and `⏎` goes on.
        {...(first ? { 'data-welcome-focus': true } : {})}
      >
        <div className="flex items-baseline justify-between gap-16">
          <span className="text-fg text-ui-strong">{choice.label}</span>
          <span className="text-fg-muted text-small">{choice.place}</span>
        </div>
        <Choices
          across
          label={choice.label}
          items={items}
          value={shown}
          onChange={(next) => void choose(choice.key, next, onFile, change)}
        />
      </div>
      <Collapse open={problem !== undefined}>
        {problem && <div className="pt-8">{problem}</div>}
      </Collapse>
    </div>
  );
}

export function LookStep(): ReactNode {
  return (
    <>
      <StepHeading title="Choose how Lo looks" line="Each choice takes effect at once." />
      <div className="flex flex-col gap-16">
        <Group first choice={themeChoice} picture={(theme) => <ThemePicture theme={theme} />} />
        <Group choice={layoutChoice} picture={(layout) => <LayoutPicture layout={layout} />} />
        <Group choice={threadsChoice} picture={(threads) => <ThreadsPicture threads={threads} />} />
      </div>
    </>
  );
}
