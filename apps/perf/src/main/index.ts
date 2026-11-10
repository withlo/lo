// The harness's main process: it reads one recorded pull request from the cache, opens a window
// set up as the app's is, and starts a background process that diffs and highlights the files
// and sends the results straight to the window over a MessagePort, as the app will.
//
//   pnpm nx run perf:open -- kubernetes-125488

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, MessageChannelMain, session, utilityProcess } from 'electron';

// electron-vite builds each script and gives its path as the import's default.
// oxlint-disable-next-line import/default
import backgroundEntry from '../background/index.ts?modulePath';
// oxlint-disable-next-line import/default
import workerEntry from '../background/worker.ts?modulePath';
import type { PullReply, Work } from '../shared/protocol.ts';
import { loadPull } from './pull.ts';
import { pageUrl, registerScheme, secureContents, secureSession } from './security.ts';

// The last argument that names a manifest, such as `kubernetes-125488`: Electron and the tools
// that start it put the app's folder and their own flags before it.
const name = process.argv.toReversed().find((arg) => /^[a-z0-9.]+(?:-[a-z0-9.]+)*-\d+$/.test(arg));
if (!name) {
  console.error('Name a recorded pull request to open, such as kubernetes-125488.');
  process.exit(1);
}

/** The window's build output and its preload, next to main's. */
const windowFiles = fileURLToPath(new URL('../window', import.meta.url));
const preload = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
/** The syntax package's folder, which holds the grammars it builds and its queries. */
const syntaxFolder = dirname(dirname(createRequire(import.meta.url).resolve('@lo/syntax')));

app.enableSandbox();
registerScheme();

app
  .whenReady()
  .then(async () => {
    const loaded = loadPull(name);
    const nonce = randomBytes(18).toString('base64');
    const windowSession = session.fromPartition('perf');
    secureSession(windowSession, windowFiles, nonce);
    app.on('web-contents-created', (_event, contents) => secureContents(contents));

    // The background process starts on the diffs as soon as the files are read. What it sends
    // waits in the channel until the window takes its end.
    const { port1, port2 } = new MessageChannelMain();
    const background = utilityProcess.fork(backgroundEntry, [], {
      serviceName: 'Lo perf background',
      stdio: 'inherit',
    });
    const { pull, jobs } = await loaded;
    const work: Work = { jobs, files: pull.files.length, syntaxFolder, workerEntry };
    background.postMessage(work, [port1]);

    ipcMain.handle('perf:pull', (): PullReply => ({ pull, nonce }));
    ipcMain.on('perf:connect', (event) => event.sender.postMessage('perf:port', null, [port2]));

    const window = new BrowserWindow({
      title: `${pull.repo}#${pull.number}`,
      width: 1440,
      height: 900,
      show: false,
      webPreferences: {
        session: windowSession,
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.once('ready-to-show', () => window.show());
    await window.loadURL(pageUrl);
  })
  .catch((error: unknown) => {
    console.error("The harness couldn't start:", error);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
