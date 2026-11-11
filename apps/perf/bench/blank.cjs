// An empty, hidden window, where the bench turns its videos into MP4 with Chromium's own encoders.
// It loads a page from disk, since the encoders need a secure context, which `about:blank` isn't.

const path = require('node:path');

const { app, BrowserWindow } = require('electron');

app
  .whenReady()
  .then(() => new BrowserWindow({ show: false }).loadFile(path.join(__dirname, 'blank.html')))
  .catch(() => app.exit(1));
