// Roslyn's language server as the C# extension for VS Code ships it, which is how `pin.ts` picks
// its version: the build the extension's newest stable release names in its `package.json`
// (`defaults.roslyn`), as the Visual Studio Marketplace serves that release for each platform,
// from the NuGet feed that release's build took it from, Microsoft's `msft_consumption` on Azure
// DevOps. Roslyn's builds are all prereleases of `main`; nuget.org has only some of them, and its
// one stable version, 5.11.0, is a build of `main` numbered as a release by mistake, unlisted
// within the hour. The extension's stable release is Microsoft's own choice of a build to ship.
//
// Each platform's package must be signed by Microsoft, as nuget.ts checks it. The feed lists no
// hash of its own to check it against, and sends each download on to the store that holds it: a
// host of its own for each file, on `vsblob.vsassets.io`, which the entry names, so Lo follows
// that redirect and no other.

import { z } from 'zod';

import { type Download, type Platform, PLATFORMS } from '../src/index.ts';
import { checkedPackage, type Signer } from './nuget.ts';
import { fetchJson, type Source, type Tools } from './sources.ts';

/** Where the Marketplace answers queries about extensions. */
const MARKETPLACE = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

/** The C# extension for VS Code. */
const EXTENSION = 'ms-dotnettools.csharp';

/** Where the Marketplace serves the C# extension's files, its `package.json` among them. */
const GALLERY_HOST = 'ms-dotnettools.gallerycdn.vsassets.io';

/** The `msft_consumption` feed, as its service index names it. */
const FEED =
  'https://pkgs.dev.azure.com/azure-public/3ccf6661-f8ce-4e8a-bb2e-eff943ddd3c7/_packaging/36a629e1-6c5b-4bcd-aa2e-6018802d6b99/nuget/v3/';

const FEED_HOST = 'pkgs.dev.azure.com';

/** A store the feed keeps a file in. */
const STORE = /^[a-z0-9]+\.vsblob\.vsassets\.io$/;

/** The most a query's answer may be: every version of the extension, with its files. */
const QUERY_LIMIT = 64 * 1024 ** 2;

/** What the Marketplace says of a version of an extension, built for one platform. */
const VERSION = z.object({
  version: z.string(),
  targetPlatform: z.string().optional(),
  properties: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  files: z.array(z.object({ assetType: z.string(), source: z.string() })),
});
type Version = z.infer<typeof VERSION>;

/** What the Marketplace says of each version of an extension. */
const QUERY = z.object({
  results: z
    .array(z.object({ extensions: z.array(z.object({ versions: z.array(VERSION) })) }))
    .length(1),
});

/** What a release's `package.json` says of the builds it ships. */
const PACKAGE = z.object({ version: z.string(), defaults: z.object({ roslyn: z.string() }) });
type Package = z.infer<typeof PACKAGE>;

/** What the feed says of a version of a package: where it is. */
const REGISTRATION = z.object({ packageContent: z.string() });

/** The Marketplace's name for each platform an extension is built for. */
const TARGETS: Record<Platform, string> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
};

/** A version's parts, for ordering: `2.160.4` before `11.9.41`. */
function parts(version: string): number[] {
  return version.split('.').map(Number);
}

function newer(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(x.length, y.length); at += 1) {
    const difference = (y[at] ?? 0) - (x[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The C# extension's newest stable release, the one the Marketplace doesn't mark as a pre-release,
 * and the Roslyn its `package.json` names for each of Lo's platforms, which must be one.
 */
export async function extensionRoslyn(tools: Tools): Promise<{ release: string; roslyn: string }> {
  const answer = await tools.fetch(MARKETPLACE, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json;api-version=7.2-preview.1',
    },
    // Its versions, their files and their properties, of the extension named exactly.
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: EXTENSION }] }],
      flags: 0x1 | 0x2 | 0x10,
    }),
  });
  const text = await answer.text();
  if (answer.status !== 200 || text.length > QUERY_LIMIT) {
    throw new Error(`The Marketplace answered ${answer.status} about ${EXTENSION}`);
  }
  const [result] = QUERY.parse(JSON.parse(text)).results;
  const versions: Version[] = (result?.extensions[0]?.versions ?? []).filter(
    (each) =>
      /^\d+\.\d+\.\d+$/.test(each.version) &&
      !each.properties.some(
        (property) =>
          property.key === 'Microsoft.VisualStudio.Code.PreRelease' && property.value === 'true',
      ),
  );
  const release = versions.map((each) => each.version).toSorted(newer)[0];
  if (release === undefined) throw new Error(`The Marketplace lists no stable ${EXTENSION}`);
  const named = new Set<string>();
  for (const platform of PLATFORMS) {
    const built: Version | undefined = versions.find(
      (each) => each.version === release && each.targetPlatform === TARGETS[platform],
    );
    const manifest: string | undefined = built?.files.find(
      (file) => file.assetType === 'Microsoft.VisualStudio.Code.Manifest',
    )?.source;
    if (manifest === undefined) {
      throw new Error(`The Marketplace has no ${EXTENSION} ${release} for ${platform}`);
    }
    if (new URL(manifest).hostname !== GALLERY_HOST) {
      throw new Error(`${EXTENSION} ${release}'s package.json isn't on ${GALLERY_HOST}`);
    }
    const pkg: Package = await fetchJson(manifest, PACKAGE, [GALLERY_HOST], tools);
    if (pkg.version !== release) {
      throw new Error(`${EXTENSION} ${release}'s package.json says it's ${pkg.version}`);
    }
    named.add(pkg.defaults.roslyn);
  }
  const [roslyn, ...others] = named;
  if (roslyn === undefined || others.length > 0) {
    throw new Error(`${EXTENSION} ${release} names more than one Roslyn: ${[...named].join(', ')}`);
  }
  return { release, roslyn };
}

/**
 * Roslyn's server, `packages` naming each platform's package and `entry` the file it starts from
 * in it, signed by `signer`, at the build the C# extension's newest stable release ships, which
 * `version` must be.
 */
export function csharpExtension(
  packages: Readonly<Record<Platform, string>>,
  entry: (platform: Platform) => string,
  signer: Signer,
): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`${version} isn’t a version of Roslyn’s`);
    }
    const { release, roslyn } = await extensionRoslyn(tools);
    if (roslyn !== version) {
      throw new Error(
        `The C# extension's newest stable release, ${release}, ships Roslyn ${roslyn}, not ${version}: pin that.`,
      );
    }
    tools.log(`The C# extension's newest stable release, ${release}, ships Roslyn ${roslyn}.`);
    const hosts = new Set([FEED_HOST]);
    const platforms: Partial<Record<Platform, Download>> = {};
    for (const platform of PLATFORMS) {
      const id = packages[platform].toLowerCase();
      const url = `${FEED}flat2/${id}/${version}/${id}.${version}.nupkg`;
      const registration = await fetchJson(
        `${FEED}registrations2-semver2/${id}/${version}.json`,
        REGISTRATION,
        [FEED_HOST],
        tools,
      );
      if (registration.packageContent !== url) {
        throw new Error(`The feed has ${id} ${version} at ${registration.packageContent}`);
      }
      const store = await storeOf(url, tools);
      hosts.add(store);
      platforms[platform] = await checkedPackage(
        url,
        [FEED_HOST, store],
        `${id} ${version}`,
        entry(platform),
        signer,
        tools,
      );
    }
    return { version, hosts: [...hosts], platforms };
  };
}

/** The host of the store the feed sends `url` on to, which must be one of its stores. */
async function storeOf(url: string, tools: Tools): Promise<string> {
  const answer = await tools.fetch(url, { method: 'GET', redirect: 'manual' });
  await answer.body?.cancel();
  const location = answer.headers.get('location');
  const host = location === null ? undefined : URL.parse(location, url)?.hostname;
  if (answer.status < 300 || answer.status > 399 || host === undefined || !STORE.test(host)) {
    throw new Error(`The feed doesn't send ${url} on to one of its stores`);
  }
  return host;
}
