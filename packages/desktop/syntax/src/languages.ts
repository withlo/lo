// The languages Lo highlights: which grammar parses each and which queries highlight it, as Zed
// pairs them, and which files and code-block names choose it.

export interface Language {
  /** The grammar's name in `grammars.json`. */
  grammar: string;
  /** File extensions, without the dot. */
  extensions: readonly string[];
  /** Other names for it, as a Markdown code block or an injection names it. */
  aliases: readonly string[];
}

export const languages = {
  bash: { grammar: 'bash', extensions: ['sh', 'bash', 'zsh'], aliases: ['sh', 'shell', 'zsh'] },
  go: { grammar: 'go', extensions: ['go'], aliases: ['golang'] },
  // Zed's JavaScript queries are written for the TSX grammar, which parses JSX too.
  javascript: {
    grammar: 'tsx',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
  },
  json: { grammar: 'json', extensions: ['json'], aliases: [] },
  jsonc: { grammar: 'json', extensions: ['jsonc'], aliases: [] },
  markdown: { grammar: 'markdown', extensions: ['md', 'markdown'], aliases: ['md'] },
  'markdown-inline': { grammar: 'markdown_inline', extensions: [], aliases: [] },
  tsx: { grammar: 'tsx', extensions: ['tsx'], aliases: [] },
  typescript: { grammar: 'typescript', extensions: ['ts', 'cts', 'mts'], aliases: ['ts'] },
  yaml: { grammar: 'yaml', extensions: ['yml', 'yaml'], aliases: ['yml'] },
} as const satisfies Record<string, Language>;

export type LanguageName = keyof typeof languages;

export const languageNames: readonly LanguageName[] = Object.keys(languages).filter(
  (name): name is LanguageName => name in languages,
);

/** The language a file is highlighted as, by its path's extension. */
export function languageOfPath(path: string): LanguageName | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return languageNames.find((language) =>
    (languages[language].extensions as readonly string[]).includes(extension),
  );
}

/** The language a name stands for, as a code block or an injection names it. */
export function languageNamed(name: string): LanguageName | undefined {
  const lower = name.trim().toLowerCase();
  return languageNames.find(
    (language) =>
      language === lower || (languages[language].aliases as readonly string[]).includes(lower),
  );
}
