import { isAbsolute, join } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Where Lo keeps its data, or undefined to keep Electron's default (`<appData>/Lo`).
 *
 * A packaged build always uses the default. An unpackaged one keeps its own folder, so a copy built
 * from source never touches an installed Lo's data, and uses `LO_USER_DATA_DIR` when it's set, so
 * each test can start from an empty folder.
 */
export function dataFolder(options: {
  packaged: boolean;
  appData: string;
  env: Environment;
}): string | undefined {
  if (options.packaged) return undefined;
  const chosen = options.env.LO_USER_DATA_DIR;
  if (chosen) {
    if (!isAbsolute(chosen)) {
      throw new Error(`LO_USER_DATA_DIR must be an absolute path, not "${chosen}".`);
    }
    return chosen;
  }
  return join(options.appData, 'Lo Dev');
}

/**
 * The address of Vite's dev server, which `electron-vite dev` passes in `ELECTRON_RENDERER_URL`.
 * Only an unpackaged build reads it, and only a server on this machine counts, so a packaged Lo
 * always loads its own files.
 */
export function devServer(options: { packaged: boolean; env: Environment }): URL | undefined {
  const address = options.env.ELECTRON_RENDERER_URL;
  if (options.packaged || !address) return undefined;
  const url = URL.parse(address);
  const local = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
  if (!url || url.protocol !== 'http:' || !local) {
    throw new Error(
      `ELECTRON_RENDERER_URL must be an http address on this machine, not "${address}".`,
    );
  }
  return url;
}
