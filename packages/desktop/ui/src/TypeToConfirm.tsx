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
   *
   * The field handles every plain `⏎` (not one with a modifier, nor one that ends a composition)
   * and calls `preventDefault()` on it, whether it confirms or not. A handler for keys above it,
   * such as the dialog's or the panel's, must ignore an event whose `defaultPrevented` is set, or
   * the same press would act twice, or on a word not yet typed.
   */
  onConfirm?: (() => void) | undefined;
  /**
   * What was typed has gone with what it confirmed: the field keeps it, in the quieter colour,
   * takes no focus and draws no ring, and nothing typed changes it.
   */
  readOnly?: boolean | undefined;
}

/**
 * The field a confirmation that bypasses rules asks for something typed in: "Type 4821 to
 * confirm". Its button stays off until `typedMatches` says the word is there, and `⏎` in the field
 * confirms only once it is, on a press of its own. It marks the `⏎` it handles with
 * `preventDefault()`: see `onConfirm`.
 */
export function TypeToConfirm({
  word,
  value,
  onChange,
  inputRef,
  onConfirm,
  readOnly = false,
}: TypeToConfirmProps) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const plain = !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
    // Not its press: a modifier makes it another command's, and a composition's ends the text.
    if (event.nativeEvent.isComposing || !plain) return;
    event.preventDefault();
    if (!event.repeat && typedMatches(value, word)) onConfirm?.();
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
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
