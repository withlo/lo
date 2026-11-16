// Settings' Language servers section: the servers Lo runs, each with what it is and its license,
// and, for one whose license the reader accepts before Lo downloads it, the license's page and the
// way to accept it or withdraw it. Main records an acceptance, and withdrawing it stops the server.

import { Button, Setting, ShownText } from '@lo/ui';
import { useEffect, useState } from 'react';

import type { ServerListing } from '../contract.ts';
import { accepts, licenses } from '../settings.ts';
import { defineSection, useSetting } from '../../settings/window/shared.ts';
import { main } from './main.ts';
import { actOnLicense } from './servers.ts';

/** What a server's row says of it: what it is, and whether its license is accepted. */
export function describeServer(server: ServerListing, accepted: boolean): string {
  const about = server.about ?? 'Run for tests';
  if (!server.license) return about;
  const { name, major } = server.license;
  return accepted
    ? `${about} · you accepted ${name}, for version ${major}`
    : `${about} · Lo downloads it once you accept ${name}`;
}

function Servers() {
  const [listed, setListed] = useState<ServerListing[]>();
  const accepted = useSetting(licenses);
  useEffect(() => {
    let current = true;
    main()
      .listServers()
      .then((servers) => {
        if (current) setListed(servers);
      })
      .catch((error: unknown) => console.error("Lo couldn't list its language servers:", error));
    return () => {
      current = false;
    };
  }, []);
  if (!listed) return null;
  return (
    <div role="list" aria-label="Language servers">
      {listed.map((server) => {
        const yes = server.license !== undefined && accepts(accepted, server.license);
        return (
          <div key={server.id} role="listitem">
            <Setting
              label={<ShownText text={server.name} />}
              description={describeServer(server, yes)}
            >
              {server.license && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void actOnLicense(server.id, 'read')}
                  >
                    Read the license
                  </Button>
                  {yes ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void actOnLicense(server.id, 'withdraw')}
                    >
                      Withdraw acceptance
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void actOnLicense(server.id, 'accept')}
                    >
                      Accept the license
                    </Button>
                  )}
                </>
              )}
            </Setting>
          </div>
        );
      })}
    </div>
  );
}

export default defineSection({
  id: 'code.languageServers',
  title: 'Language servers',
  description:
    'The servers Lo downloads for the languages they read, on repos you trust. One with a license of its own downloads once you accept it.',
  order: 21,
  render: Servers,
});
