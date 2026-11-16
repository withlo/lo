import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Loads the background process's entry as the process would, with a stand-in for main's port. */
function load(cap: string | undefined) {
  vi.resetModules();
  vi.stubEnv('LO_BACKGROUND_MEMORY_CAP_MB', cap);
  vi.stubEnv('LO_TEST_JOBS', '');
  const on = vi.fn<(event: string, listener: () => void) => void>();
  // Only Electron's utility processes have a parent port.
  Object.defineProperty(process, 'parentPort', { value: { on }, configurable: true });
  return { on, loaded: import('./index.ts') };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(process, 'parentPort');
});

describe('the background process’s entry', () => {
  it('starts and listens for main’s connections when it has a memory cap', async () => {
    const { on, loaded } = load('2048');
    await loaded;
    expect(on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  // The throw is what stops a utility process at startup, with the reason on its stderr, so that
  // main starts it again. Carrying on would size the pool from NaN, and every job would wait for
  // a worker slot that never opens.
  it('stops at startup, with the reason, when main set no memory cap', async () => {
    const { on, loaded } = load(undefined);
    await expect(loaded).rejects.toThrow(
      'The background process needs LO_BACKGROUND_MEMORY_CAP_MB, a whole number of megabytes, and got nothing.',
    );
    expect(on).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-5', '1.5', 'lots'])(
    'stops at startup when the memory cap is %j',
    async (cap) => {
      const { on, loaded } = load(cap);
      await expect(loaded).rejects.toThrow('needs LO_BACKGROUND_MEMORY_CAP_MB');
      expect(on).not.toHaveBeenCalled();
    },
  );

  it('refuses the window the jobs only main may send, which main’s own port runs', async () => {
    const { on, loaded } = load('2048');
    await loaded;
    const connect = on.mock.calls.find(([event]) => event === 'message')?.[1];
    const replies: unknown[] = [];
    const heard: ((event: { data: unknown }) => void)[] = [];
    const port = {
      on: (_event: string, hear: (event: { data: unknown }) => void) => {
        heard.push(hear);
      },
      postMessage: (reply: unknown) => {
        replies.push(reply);
      },
      start: () => undefined,
    };
    Reflect.apply(connect ?? (() => undefined), undefined, [{ data: 'connect', ports: [port] }]);
    for (const hear of heard) hear({ data: { id: 1, job: 'code.symbols', input: { files: [] } } });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ id: 1, ok: false, error: { code: 'unavailable' } });
  });
});
