// The languages Lo highlights: which grammar parses each, and which files and code-block names
// choose it. A language's queries are in `queries/<language>/`.

export interface Language {
  /** The grammar's name in `grammars.json`. */
  grammar: string;
  /** File extensions, without the dot. */
  extensions: readonly string[];
  /** Whole file names that choose it, such as `Gemfile`, matched exactly. */
  names?: readonly string[];
  /** Other names for it, as a Markdown code block or an injection names it. */
  aliases: readonly string[];
}

export const languages = {
  bash: { grammar: 'bash', extensions: ['sh', 'bash', 'zsh'], aliases: ['sh', 'shell', 'zsh'] },
  csharp: { grammar: 'c_sharp', extensions: ['cs'], aliases: ['c#', 'cs'] },
  css: { grammar: 'css', extensions: ['css', 'pcss', 'postcss'], aliases: [] },
  elixir: { grammar: 'elixir', extensions: ['ex', 'exs'], names: ['mix.lock'], aliases: ['ex'] },
  go: { grammar: 'go', extensions: ['go'], aliases: ['golang'] },
  // HCL without Terraform's own words, for the `.hcl` files of Packer, Nomad and the like.
  hcl: { grammar: 'hcl', extensions: ['hcl'], aliases: [] },
  html: { grammar: 'html', extensions: ['html', 'htm'], aliases: ['htm'] },
  java: { grammar: 'java', extensions: ['java'], aliases: [] },
  // JavaScript is parsed with the TSX grammar, which parses JSX too, and takes its queries.
  javascript: {
    grammar: 'tsx',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
  },
  json: { grammar: 'json', extensions: ['json'], aliases: [] },
  jsonc: { grammar: 'json', extensions: ['jsonc'], aliases: [] },
  kotlin: { grammar: 'kotlin', extensions: ['kt', 'kts'], aliases: ['kt'] },
  markdown: { grammar: 'markdown', extensions: ['md', 'markdown'], aliases: ['md'] },
  // Markdown's injections name it by its grammar's name.
  'markdown-inline': { grammar: 'markdown_inline', extensions: [], aliases: ['markdown_inline'] },
  php: { grammar: 'php', extensions: ['php', 'phtml'], aliases: [] },
  python: { grammar: 'python', extensions: ['py', 'pyi'], aliases: ['py', 'python3'] },
  ruby: {
    grammar: 'ruby',
    extensions: ['rb', 'rbi', 'rake', 'gemspec', 'ru', 'thor', 'jbuilder', 'rabl', 'builder'],
    names: [
      'Gemfile',
      'Rakefile',
      'Podfile',
      'Brewfile',
      'Vagrantfile',
      'Fastfile',
      'Appfile',
      'Matchfile',
      'Dangerfile',
      'Guardfile',
      'Capfile',
      'Berksfile',
      'Thorfile',
      'Steepfile',
    ],
    aliases: ['rb'],
  },
  rust: { grammar: 'rust', extensions: ['rs'], aliases: ['rs'] },
  swift: { grammar: 'swift', extensions: ['swift', 'swiftinterface'], aliases: [] },
  terraform: { grammar: 'hcl', extensions: ['tf', 'tfvars', 'tofu'], aliases: ['tf'] },
  toml: { grammar: 'toml', extensions: ['toml'], names: ['Cargo.lock', 'Pipfile'], aliases: [] },
  tsx: { grammar: 'tsx', extensions: ['tsx'], aliases: [] },
  typescript: { grammar: 'typescript', extensions: ['ts', 'cts', 'mts'], aliases: ['ts'] },
  yaml: { grammar: 'yaml', extensions: ['yml', 'yaml'], aliases: ['yml'] },
} as const satisfies Record<string, Language>;

export type LanguageName = keyof typeof languages;

export const languageNames: readonly LanguageName[] = Object.keys(languages).filter(
  (name): name is LanguageName => name in languages,
);

/** The table without its literal types, so every entry has every field. */
const table: Readonly<Record<LanguageName, Language>> = languages;

/** The language a file is highlighted as, by its name or else its path's extension. */
export function languageOfPath(path: string): LanguageName | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const named = languageNames.find((language) => table[language].names?.includes(name));
  if (named) return named;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return languageNames.find((language) => table[language].extensions.includes(extension));
}

/** The language a name stands for, as a code block or an injection names it. */
export function languageNamed(name: string): LanguageName | undefined {
  const lower = name.trim().toLowerCase();
  return languageNames.find(
    (language) => language === lower || table[language].aliases.includes(lower),
  );
}
