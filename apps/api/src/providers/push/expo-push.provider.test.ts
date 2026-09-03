import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpoPushProvider } from './expo-push.provider.js';

/**
 * Expo push delivery.
 *
 * The costly mistake here is not a failed send - the queue retries those - it is
 * revoking a token that was actually fine, because a revoked token silences a
 * real person's device permanently and nothing ever tells them. So the pruning
 * rules are pinned as tightly as the happy path.
 */

const token = (n: number) => `ExponentPushToken[device-${n}]`;
const config = { get: () => 'expo-access-token' } as never;

function respond(tickets: unknown[], ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ data: tickets }),
    text: async () => 'upstream detail',
  });
}

function provider() {
  return new ExpoPushProvider(config);
}

const message = { tokens: [token(1)], title: 'Asset assigned', body: 'A laptop is now with you' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sending a push through Expo', () => {
  it('posts the message and counts what was accepted', async () => {
    const fetchMock = respond([{ status: 'ok', id: 'x' }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send({ ...message, data: { linkPath: '/assets/1' } });

    expect(result).toEqual({ accepted: 1, simulated: false, invalidTokens: [] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.headers.authorization).toBe('Bearer expo-access-token');
    expect(JSON.parse(init.body)).toEqual([
      {
        to: token(1),
        title: 'Asset assigned',
        body: 'A laptop is now with you',
        data: { linkPath: '/assets/1' },
      },
    ]);
  });

  it('never reports a real send as simulated', async () => {
    vi.stubGlobal('fetch', respond([{ status: 'ok' }]));
    expect((await provider().send(message)).simulated).toBe(false);
  });

  it('chunks into requests of 100, because Expo rejects more', async () => {
    const tokens = Array.from({ length: 250 }, (_, i) => token(i));
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: (JSON.parse(init.body) as unknown[]).map(() => ({ status: 'ok' })),
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send({ ...message, tokens });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(result.accepted).toBe(250);
  });

  it('returns tokens Expo says are gone, so they can be pruned', async () => {
    vi.stubGlobal(
      'fetch',
      respond([
        { status: 'ok' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok' },
      ]),
    );

    const result = await provider().send({ ...message, tokens: [token(1), token(2), token(3)] });

    expect(result.accepted).toBe(2);
    expect(result.invalidTokens).toEqual([token(2)]);
  });

  it('does not prune for errors that are the operator problem, not the device', async () => {
    // InvalidCredentials means the FCM key on the Expo project is wrong. Every
    // token fails, and revoking all of them would silence the whole fleet for a
    // mistake in one setting.
    vi.stubGlobal(
      'fetch',
      respond([
        { status: 'error', message: 'bad credentials', details: { error: 'InvalidCredentials' } },
        { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
      ]),
    );

    const result = await provider().send({ ...message, tokens: [token(1), token(2)] });

    expect(result.accepted).toBe(0);
    expect(result.invalidTokens).toEqual([]);
  });

  it('prunes nothing when the ticket count does not line up with the batch', async () => {
    // Tickets map to tokens by position. A short array means the mapping is
    // guesswork, and a wrong guess revokes a live device.
    vi.stubGlobal(
      'fetch',
      respond([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]),
    );

    const result = await provider().send({ ...message, tokens: [token(1), token(2), token(3)] });

    expect(result.invalidTokens).toEqual([]);
    expect(result.accepted).toBe(0);
  });

  it('rejects tokens that are not Expo tokens without calling Expo at all', async () => {
    const fetchMock = respond([]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send({ ...message, tokens: ['fcm-raw-token', ''] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      accepted: 0,
      simulated: false,
      invalidTokens: ['fcm-raw-token', ''],
    });
  });

  it('accepts the ExpoPushToken spelling as well as ExponentPushToken', async () => {
    const fetchMock = respond([{ status: 'ok' }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().send({ ...message, tokens: ['ExpoPushToken[abc]'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.accepted).toBe(1);
  });

  it('throws on an HTTP failure so the queue retries instead of reporting delivery', async () => {
    vi.stubGlobal('fetch', respond([], false, 502));
    await expect(provider().send(message)).rejects.toThrow(/502/);
  });

  it('omits the authorization header when no access token is configured', async () => {
    const fetchMock = respond([{ status: 'ok' }]);
    vi.stubGlobal('fetch', fetchMock);

    await new ExpoPushProvider({ get: () => undefined } as never).send(message);

    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBeUndefined();
  });
});
