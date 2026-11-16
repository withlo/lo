// Preloaded with `-r` in a live run (`live` in app.ts), after Playwright's own preload, which adds
// Chromium's stand-ins for the system's keychain to every Electron it starts: the Mac's mock
// keychain, and Linux's basic store. This takes them off again before Lo starts, so its
// `safeStorage` keeps tokens with the system's keychain, as it does outside the tests.

const { app } = require('electron');

for (const name of ['use-mock-keychain', 'password-store']) app.commandLine.removeSwitch(name);
