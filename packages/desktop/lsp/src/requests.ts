/**
 * Lo's answers to what a server asks of it. A server may ask for its settings, register
 * capabilities and make progress tokens. Everything else is refused: edits to the workspace,
 * showing a document or asking the reader something, and any request Lo doesn't know. A refusal
 * goes back to the server as an error and into its log, and nothing of it reaches the window.
 */

/** What Lo answers a server's request with. */
export type Reply =
  | { readonly accepted: true; readonly result: unknown }
  | { readonly accepted: false; readonly message: string };

export interface ReplyContext {
  /** What `workspace/configuration` answers from: the adapter's settings, by section. */
  readonly settings: unknown;
  /** The workspace's folders, for `workspace/workspaceFolders`. */
  readonly folders: readonly { readonly uri: string; readonly name: string }[];
}

/** The most items one `workspace/configuration` may ask for. */
const CONFIGURATION_ITEMS = 1000;

/** Lo's answer to the server's request `method` with `params`. */
export function reply(method: string, params: unknown, context: ReplyContext): Reply {
  switch (method) {
    case 'workspace/configuration':
      return configuration(params, context.settings);
    case 'workspace/workspaceFolders':
      return { accepted: true, result: context.folders };
    case 'client/registerCapability':
    case 'client/unregisterCapability':
    case 'window/workDoneProgress/create':
      return { accepted: true, result: null };
    case 'workspace/applyEdit':
      return { accepted: false, message: 'Lo never edits files.' };
    case 'window/showDocument':
    case 'window/showMessageRequest':
      return { accepted: false, message: 'Lo shows nothing a language server asks it to.' };
    default:
      return { accepted: false, message: 'Lo doesn’t answer this request.' };
  }
}

/** Each item's section of `settings`, or `null` where it has none. */
function configuration(params: unknown, settings: unknown): Reply {
  const items = isObject(params) ? params.items : undefined;
  if (!Array.isArray(items) || items.length > CONFIGURATION_ITEMS) {
    return { accepted: false, message: 'The request names no settings Lo can look up.' };
  }
  return {
    accepted: true,
    result: items.map((item: unknown) => {
      const section = isObject(item) ? item.section : undefined;
      return typeof section === 'string' ? sectionOf(settings, section) : (settings ?? null);
    }),
  };
}

/** The value at the dotted `section` of `settings`, or `null`. */
export function sectionOf(settings: unknown, section: string): unknown {
  let value = settings;
  for (const key of section === '' ? [] : section.split('.')) {
    if (!isObject(value) || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return value ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
