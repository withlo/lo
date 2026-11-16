import { useId, type KeyboardEvent, type Ref } from 'react';

import { Input } from './Input.tsx';

/** Whether what was typed is the word to type, exactly: no space round it, no other case. */
export function typedMatches(value: string, word: string): boolean {
  return value === word;
}

export interface TypeToConfirmProps {
  /** What to type: the pull request's number, as a confirmation that skips rules asks for. */
  word: string;
  value: string;
  onChange: (value: string) => void;
  /** The field, for the dialog to give focus to as it opens and when it asks again. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  /**
   * `⏎` was pressed with the word typed. Only a fresh press counts: a key held down repeats, and
   * the press that opened the dialog was never pressed here, so neither confirms.
   */
  onConfirm?: (() => void) | undefined;
}

/**
 * The field a confirmation that bypasses rules asks for something typed in: "Type 4821 to
 * confirm". Its button stays off until `typedMatches` says the word is there, and `⏎` in the field
 * confirms only once it is, on a press of its own.
 */
export function TypeToConfirm({ word, value, onChange, inputRef, onConfirm }: TypeToConfirmProps) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const plain = !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
    if (event.repeat || event.nativeEvent.isComposing || !plain) return;
    if (typedMatches(value, word)) onConfirm?.();
  };
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
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
