import { describe, expect, it } from 'vitest';
import { createConsolePushProvider, createExpoPushProvider } from './index.js';

const msg = (to) => ({ to, title: 'New order', body: '2 items', data: { orderId: 'o1' }, sound: 'default' });
const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(JSON.parse(init.body), init);
  };
  return Object.assign(fn, { calls });
};
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

describe('push providers', () => {
  it('console provider records and reports success', async () => {
    const p = createConsolePushProvider();
    const r = await p.send([msg('a'), msg('b')]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(p.sent.map((m) => m.to)).toEqual(['a', 'b']);
  });

  it('expo provider maps tickets back to messages and flags unregistered devices (fake endpoint only)', async () => {
    const f = fakeFetch((batch) =>
      json(200, {
        data: batch.map((m) =>
          m.to === 'gone'
            ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `ticket-${m.to}` },
        ),
      }),
    );
    const p = createExpoPushProvider({ fetch: /** @type {any} */ (f), accessToken: 'tok' });
    const r = await p.send([msg('a'), msg('gone')]);
    expect(r).toEqual([
      { ok: true, providerRef: 'ticket-a' },
      { ok: false, error: 'DeviceNotRegistered', deviceGone: true },
    ]);
    expect(f.calls[0].init.headers.authorization).toBe('Bearer tok');
    expect(f.calls[0].body[0]).toMatchObject({ to: 'a', title: 'New order', data: { orderId: 'o1' } });
  });

  it('expo provider batches by 100 and reports HTTP and network failures per message', async () => {
    let n = 0;
    const f = fakeFetch((batch) => {
      n++;
      if (n === 2) return json(500, { errors: [] });
      return json(200, { data: batch.map(() => ({ status: 'ok', id: 't' })) });
    });
    const p = createExpoPushProvider({ fetch: /** @type {any} */ (f) });
    const r = await p.send(Array.from({ length: 150 }, (_, i) => msg(`d${i}`)));
    expect(f.calls.map((c) => c.body.length)).toEqual([100, 50]);
    expect(r.slice(0, 100).every((x) => x.ok)).toBe(true);
    expect(r.slice(100).every((x) => !x.ok && x.error === 'Expo push HTTP 500')).toBe(true);
    const down = createExpoPushProvider({
      fetch: /** @type {any} */ (
        async () => {
          throw new Error('network down');
        }
      ),
    });
    expect(await down.send([msg('x')])).toEqual([{ ok: false, error: 'network down' }]);
  });
});
