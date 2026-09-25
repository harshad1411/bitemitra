// Runs the Prisma CLI with the repository .env loaded. The CLI is resolved through Node's module resolution,
// so it works whether pnpm hoists it to the root node_modules or keeps it next to this package.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const envFile = new URL('../../../.env', import.meta.url).pathname;
const nodeArgs = existsSync(envFile) ? [`--env-file=${envFile}`] : [];
const r = spawnSync(process.execPath, [...nodeArgs, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
