import { useId, type Ref } from 'react';

import { Input } from './Input.tsx';

/** Whether what was typed is the word to type, as written, but for the space round it. */
export function typedMatches(value: string, word: string): boolean {
  return value.trim() === word;
}

export interface TypeToConfirmProps {
  /** What to type: the pull request's number, as a confirmation that skips rules asks for. */
  word: string;
  value: string;
  onChange: (value: string) => void;
  /** The field, for the dialog to give focus to as it opens and when it asks again. */
  inputRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * The field a confirmation that bypasses rules asks for something typed in: "Type 4821 to
 * confirm". Its button stays off until `typedMatches` says the word is there.
 */
export function TypeToConfirm({ word, value, onChange, inputRef }: TypeToConfirmProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-6">
      <label htmlFor={id} className="text-fg text-ui-strong">
        Type <span className="code-text">{word}</span> to confirm
      </label>
      <Input
        id={id}
        ref={inputRef}
        mono
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
