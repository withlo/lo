/**
 * What Lo tells a server it can do, in `initialize`: read-only answers about code, and nothing
 * that edits, diagnoses or completes it.
 */

import type {
  ClientCapabilities,
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
  SymbolKind,
} from 'vscode-languageserver-protocol';

/** Every symbol kind there is, which the outline can show. */
const SYMBOL_KINDS: SymbolKind[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
];

/**
 * Lo's client capabilities: hovers in Markdown, definitions, references, inlay hints and document
 * symbols, work-done progress, workspace configuration and folders, and positions in UTF-16. No
 * diagnostics, completion, rename, code actions, formatting, `applyEdit` or `showDocument`.
 */
export const CLIENT_CAPABILITIES: ClientCapabilities = {
  general: {
    positionEncodings: ['utf-16'],
  },
  window: {
    workDoneProgress: true,
  },
  workspace: {
    configuration: true,
    workspaceFolders: true,
  },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    hover: { dynamicRegistration: false, contentFormat: ['markdown'] },
    definition: { dynamicRegistration: false },
    references: { dynamicRegistration: false },
    inlayHint: { dynamicRegistration: false },
    documentSymbol: {
      dynamicRegistration: false,
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: SYMBOL_KINDS },
    },
  },
};

/**
 * The parameters of `initialize` for a server on the checkout at `rootUri`, or, for a rootless
 * one, `null`: then it hears of no workspace at all, only of the files Lo opens.
 */
export function initializeParams(options: {
  readonly rootUri: string | null;
  readonly name: string;
  readonly version: string | undefined;
  readonly initializationOptions: unknown;
}): InitializeParams {
  const { rootUri, name, version, initializationOptions } = options;
  return {
    // A server whose client is gone exits by itself.
    processId: process.pid,
    clientInfo: version === undefined ? { name: 'Lo' } : { name: 'Lo', version },
    locale: 'en',
    rootUri,
    workspaceFolders: rootUri === null ? null : [{ uri: rootUri, name }],
    capabilities: CLIENT_CAPABILITIES,
    initializationOptions,
    trace: 'off',
  };
}

/**
 * The capabilities in a server's answer to `initialize`, when it's an answer Lo can use, or what's
 * wrong with it.
 */
export function initializeAnswer(
  answer: unknown,
): { readonly capabilities: ServerCapabilities } | { readonly wrong: string } {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    return { wrong: 'Its answer to initialize isn’t an object.' };
  }
  const { capabilities } = answer as Partial<InitializeResult>;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return { wrong: 'Its answer to initialize has no capabilities.' };
  }
  const encoding: unknown = capabilities.positionEncoding;
  if (encoding !== undefined && encoding !== 'utf-16') {
    return { wrong: 'It asked for positions in an encoding Lo didn’t offer.' };
  }
  return { capabilities };
}
