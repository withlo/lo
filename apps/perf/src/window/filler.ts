// Text for the recorded threads' comments, since the manifests keep only each comment's length.

const sentences = [
  'This reads well, but the error path still needs a test.',
  'Could we keep the old name for one release, so callers have time to move?',
  'Nit: the comment above no longer matches what the function does.',
  'I think this check belongs before the loop, not inside it.',
  'Does this hold when the list is empty?',
  'Good catch. The cache would have gone stale here.',
];

/** Text of exactly `length` characters, made of whole sentences where it can be. */
export function fillerText(length: number, seed: number): string {
  let text = '';
  for (let index = seed; text.length < length; index++) {
    text += `${text ? ' ' : ''}${sentences[index % sentences.length]}`;
  }
  return text.slice(0, length);
}
