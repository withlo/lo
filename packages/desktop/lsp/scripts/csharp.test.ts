// pin.ts's choice of Roslyn's build, the one the C# extension for VS Code's newest stable release
// ships, and its checks of where each package comes from, against a server on this machine
// standing in for the Marketplace and the feed.

import { expect, test } from 'vitest';

import { PLATFORMS } from '../src/index.ts';
import { type Routes, serve, zip } from '../test/downloads.ts';
import { tempFolder } from '../test/support.ts';
import { csharpExtension, extensionRoslyn } from './csharp.ts';
import { DIGICERT_G4 } from './nuget.ts';

const MARKETPLACE = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
const GALLERY = 'https://ms-dotnettools.gallerycdn.vsassets.io/extensions/ms-dotnettools/csharp/';
const FEED =
  'https://pkgs.dev.azure.com/azure-public/3ccf6661-f8ce-4e8a-bb2e-eff943ddd3c7/_packaging/36a629e1-6c5b-4bcd-aa2e-6018802d6b99/nuget/v3/';

const MICROSOFT = { organization: 'Microsoft Corporation', roots: [DIGICERT_G4] };

/** Each platform's package, by the name pin.ts gives it. */
const PACKAGES = {
  'darwin-arm64': 'server.osx-arm64',
  'darwin-x64': 'server.osx-x64',
  'linux-x64': 'server.linux-x64',
  'linux-arm64': 'server.linux-arm64',
} as const;

/** A release of the extension: its version, whether it's a pre-release, and the Roslyn it names. */
interface Release {
  readonly version: string;
  readonly pre?: boolean;
  readonly roslyn: string | Partial<Record<string, string>>;
  readonly host?: string;
}

/** The Marketplace answering with `releases`, each built for every platform. */
function marketplace(releases: readonly Release[]): Routes {
  const routes: Routes = {};
  const versions = releases.flatMap((release) =>
    PLATFORMS.map((platform) => {
      const roslyn = typeof release.roslyn === 'string' ? release.roslyn : release.roslyn[platform];
      const base = release.host === undefined ? GALLERY : `https://${release.host}/`;
      const source = `${base}${release.version}/${platform}/Microsoft.VisualStudio.Code.Manifest`;
      routes[source] = {
        body: Buffer.from(JSON.stringify({ version: release.version, defaults: { roslyn } })),
      };
      return {
        version: release.version,
        targetPlatform: platform,
        properties: release.pre
          ? [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
          : [],
        files: [{ assetType: 'Microsoft.VisualStudio.Code.Manifest', source }],
      };
    }),
  );
  routes[MARKETPLACE] = {
    body: Buffer.from(JSON.stringify({ results: [{ extensions: [{ versions }] }] })),
  };
  return routes;
}

/** The feed holding `version` of each package, sending each on to `store`, with `body` there. */
function feed(version: string, store: string, body: Buffer): Routes {
  const routes: Routes = {};
  for (const name of Object.values(PACKAGES)) {
    const url = `${FEED}flat2/${name}/${version}/${name}.${version}.nupkg`;
    routes[`${FEED}registrations2-semver2/${name}/${version}.json`] = {
      body: Buffer.from(JSON.stringify({ packageContent: url })),
    };
    routes[url] = { redirect: `https://${store}/${name}.nupkg?sig=x`, status: 303 };
    routes[`https://${store}/${name}.nupkg?sig=x`] = { body };
  }
  return routes;
}

async function tools(routes: Routes) {
  const { fetch, asked } = await serve(routes);
  const lines: string[] = [];
  return {
    asked,
    lines,
    tools: { fetch, folder: tempFolder(), log: (line: string) => lines.push(line) },
  };
}

const source = csharpExtension(
  PACKAGES,
  (platform) => `tools/net10.0/${PACKAGES[platform]}/server.dll`,
  MICROSOFT,
);

test('takes the Roslyn the extension’s newest stable release names, not a newer pre-release’s', async () => {
  const { tools: given } = await tools(
    marketplace([
      { version: '11.9.41', pre: true, roslyn: '5.14.0-1.2.3' },
      { version: '2.160.4', roslyn: '5.12.0-1.26452.1' },
      { version: '2.90.60', roslyn: '5.0.0-1.1.1' },
    ]),
  );
  expect(await extensionRoslyn(given)).toEqual({ release: '2.160.4', roslyn: '5.12.0-1.26452.1' });
});

test('refuses any other version, naming the one to pin', async () => {
  const { tools: given } = await tools(
    marketplace([{ version: '2.160.4', roslyn: '5.12.0-1.26452.1' }]),
  );
  await expect(source('5.11.0', given)).rejects.toThrow(
    "The C# extension's newest stable release, 2.160.4, ships Roslyn 5.12.0-1.26452.1, not 5.11.0: pin that.",
  );
  await expect(source('5.11.0/../x', given)).rejects.toThrow(/isn’t a version of Roslyn’s/);
});

test('refuses a release whose platforms name different Roslyns, or whose package.json is elsewhere', async () => {
  const differs = await tools(
    marketplace([
      {
        version: '2.160.4',
        roslyn: {
          'darwin-arm64': '5.12.0-1.1',
          'darwin-x64': '5.12.0-1.1',
          'linux-x64': '5.12.0-1.2',
          'linux-arm64': '5.12.0-1.1',
        },
      },
    ]),
  );
  await expect(extensionRoslyn(differs.tools)).rejects.toThrow(/names more than one Roslyn/);
  const elsewhere = await tools(
    marketplace([{ version: '2.160.4', roslyn: '5.12.0-1.1', host: 'example.com' }]),
  );
  await expect(extensionRoslyn(elsewhere.tools)).rejects.toThrow(
    /package\.json isn't on ms-dotnettools\.gallerycdn\.vsassets\.io/,
  );
});

test('refuses a package the feed sends anywhere but its stores, or one Microsoft didn’t sign', async () => {
  const version = '5.12.0-1.26452.1';
  const release = marketplace([{ version: '2.160.4', roslyn: version }]);
  const unsigned = zip([{ path: 'tools/net10.0/server.dll', data: 'the server' }]);
  const away = await tools({ ...release, ...feed(version, 'example.com', unsigned) });
  await expect(source(version, away.tools)).rejects.toThrow(
    /doesn't send .*server\.osx-arm64\.5\.12\.0-1\.26452\.1\.nupkg on to one of its stores/,
  );
  expect(away.asked.some((url) => url.startsWith('https://example.com/'))).toBe(false);
  const store = 'abcvsblobprodwus2143.vsblob.vsassets.io';
  const stored = await tools({ ...release, ...feed(version, store, unsigned) });
  await expect(source(version, stored.tools)).rejects.toThrow(/signature/i);
  expect(stored.asked).toContain(`https://${store}/server.osx-arm64.nupkg?sig=x`);
});
