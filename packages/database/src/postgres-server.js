// Real PostgreSQL binaries from npm (embedded-postgres) — used for local development and tests so no
// system-wide PostgreSQL or Docker install is required (TESTING.md §1).
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

/**
 * @param {{ dataDir: string, port?: number, persistent?: boolean, fresh?: boolean }} options
 * @returns {Promise<{ adminUrl: string, port: number, stop: () => Promise<void> }>}
 */
export async function startPostgresServer({ dataDir, port, persistent = false, fresh = false }) {
  const actualPort = port ?? (await freePort());
  if (fresh) await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: actualPort,
    persistent,
    onLog: () => {},
    onError: (e) => console.error('[embedded-postgres]', e),
  });
  try {
    await pg.initialise();
  } catch (err) {
    // Already initialised (persistent development cluster) — anything else is re-thrown by start().
    if (!/exists|not empty/i.test(String(err?.message ?? err))) throw err;
  }
  await pg.start();
  return {
    adminUrl: `postgresql://postgres:postgres@127.0.0.1:${actualPort}/postgres`,
    port: actualPort,
    stop: () => pg.stop(),
  };
}
