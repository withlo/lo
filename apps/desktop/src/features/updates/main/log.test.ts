import { describe, expect, it } from 'vitest';

import { logLine, reasonOf, updaterLogger, withoutQueries } from './log.ts';

/** An error as electron-updater makes one: its message, and its code. */
function updaterError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('what electron-updater logs', () => {
  it('keeps no address’s query or fragment, which can sign a download', () => {
    expect(
      withoutQueries(
        'Downloading update from https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r&sv=2018&sig=abc%2F&se=2026 to /tmp/x',
      ),
    ).toBe(
      'Downloading update from https://release-assets.githubusercontent.com/github-production-release-asset/1/2 to /tmp/x',
    );
    expect(withoutQueries('url: "http://127.0.0.1:4100/x.zip#frag" done')).toBe(
      'url: "http://127.0.0.1:4100/x.zip" done',
    );
    expect(withoutQueries('Is this right? Yes.')).toBe('Is this right? Yes.');
  });

  it('goes to Lo’s log, errors with their stack, each cut to a length', () => {
    const lines: string[] = [];
    const logger = updaterLogger((line) => lines.push(line));
    logger.info('Checking for update');
    logger.warn(new Error('at https://github.com/withlo/lo/releases/download/v1/x.zip?token=1'));
    logger.error(`Cannot parse releases feed: ${'<entry/>'.repeat(1000)}`);
    expect(lines[0]).toBe('Checking for update');
    expect(lines[1]).toContain(
      'Error: at https://github.com/withlo/lo/releases/download/v1/x.zip\n',
    );
    expect(lines[1]).not.toContain('token');
    expect(lines[2]?.endsWith('… (cut)')).toBe(true);
    expect(lines[2]?.length).toBeLessThan(2100);
  });

  it('says a value that isn’t text or an error as text', () => {
    expect(logLine(42)).toBe('42');
  });
});

describe('why a check or a download failed', () => {
  it('names a network error', () => {
    const error = new Error('net::ERR_INTERNET_DISCONNECTED');
    expect(reasonOf(error, 'check')).toBe(
      'Lo couldn’t reach GitHub (ERR_INTERNET_DISCONNECTED). Check your connection, then try again.',
    );
    const wrapped = updaterError(
      'Unable to find latest version on GitHub (https://github.com/withlo/lo/releases/latest), please ensure a production release exists: Error: net::ERR_NAME_NOT_RESOLVED',
      'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    );
    expect(reasonOf(wrapped, 'check')).toContain('(ERR_NAME_NOT_RESOLVED)');
  });

  it('says what GitHub answered', () => {
    const error = Object.assign(new Error('HttpError: 503'), { statusCode: 503 });
    expect(reasonOf(error, 'download')).toBe('GitHub answered 503. Try again later.');
    const none = updaterError(
      'Unable to find latest version on GitHub (https://github.com/withlo/lo/releases/latest), please ensure a production release exists: HttpError: 404 \n"method: GET url: …"',
      'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    );
    expect(reasonOf(none, 'check')).toBe('GitHub has no release of Lo yet.');
  });

  it('says when a release has nothing for this computer, or a download didn’t match', () => {
    expect(
      reasonOf(
        updaterError('Cannot find latest-mac.yml', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'),
        'check',
      ),
    ).toBe('The newest release on GitHub has no download for this computer.');
    expect(
      reasonOf(updaterError('sha512 checksum mismatch', 'ERR_CHECKSUM_MISMATCH'), 'download'),
    ).toBe('The download didn’t match the release’s checksum, so Lo deleted it. Try again.');
  });

  it('says when the update isn’t signed as this Lo is', () => {
    const error = new Error(
      'Code signature at URL file:///private/var/x/Lo.app/ did not pass validation: code failed to satisfy specified code requirement(s)',
    );
    expect(reasonOf(error, 'download')).toBe(
      'The update isn’t signed as this Lo is, so Lo won’t install it.',
    );
  });

  it('says something plain for anything else', () => {
    expect(reasonOf(new Error('Cannot parse releases feed'), 'check')).toBe(
      'Lo couldn’t read the newest release on GitHub.',
    );
    expect(reasonOf('nope', 'download')).toBe('The download stopped before it finished.');
  });
});
