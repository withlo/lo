import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';

import type { Page } from '@playwright/test';

import { expect, test } from './app.ts';

/**
 * Starts WebRTC in the page against an ICE server, and waits until it has gathered its candidates.
 * The content security policy has no say over WebRTC, so this runs with it in force.
 */
async function gather(page: Page, ice: RTCIceServer): Promise<string[]> {
  return page.evaluate(async (server) => {
    const connection = new RTCPeerConnection({ iceServers: [server] });
    connection.createDataChannel('probe');
    const candidates: string[] = [];
    connection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) candidates.push(candidate.candidate);
    });
    const gathered = new Promise<void>((resolve) => {
      connection.addEventListener('icegatheringstatechange', () => {
        if (connection.iceGatheringState === 'complete') resolve();
      });
    });
    await connection.setLocalDescription(await connection.createOffer());
    await Promise.race([gathered, new Promise((resolve) => setTimeout(resolve, 5000))]);
    connection.close();
    return candidates;
  }, ice);
}

test('WebRTC sends no UDP', async ({ page }) => {
  const stun = createSocket('udp4');
  const packets: number[] = [];
  stun.on('message', (message) => packets.push(message.length));
  await new Promise<void>((resolve) => stun.bind(0, '127.0.0.1', resolve));

  const candidates = await gather(page, { urls: `stun:127.0.0.1:${stun.address().port}` });
  stun.close();
  expect(candidates).toEqual([]);
  expect(packets).toEqual([]);
});

test('WebRTC opens no connection, even over TCP', async ({ page }) => {
  let connections = 0;
  const turn = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => turn.listen(0, '127.0.0.1', resolve));
  const address = turn.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const candidates = await gather(page, {
    urls: `turn:127.0.0.1:${port}?transport=tcp`,
    username: 'lo',
    credential: 'lo',
  });
  await new Promise((resolve) => turn.close(resolve));
  expect(candidates).toEqual([]);
  expect(connections).toBe(0);
});

test("the window's session sends everything to a proxy nothing can listen on", async ({
  app,
  page,
}) => {
  // The window opens once its session is secured.
  await expect(page.locator('header.strip')).toBeVisible();
  const proxies = await app.evaluate(({ session }) => {
    const windowSession = session.fromPartition('persist:window');
    return Promise.all(
      ['https://example.com/', 'http://127.0.0.1:8080/', 'http://localhost/'].map((url) =>
        windowSession.resolveProxy(url),
      ),
    );
  });
  expect(proxies).toEqual(['PROXY 127.0.0.1:0', 'PROXY 127.0.0.1:0', 'PROXY 127.0.0.1:0']);
});
