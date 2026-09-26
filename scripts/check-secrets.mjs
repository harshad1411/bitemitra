#!/usr/bin/env node
// Secret scan (D-100): fails if a tracked file looks like it contains a real secret. Runs in CI and with
// `pnpm check:secrets`. Test fixtures use obviously fake values that do not match these patterns.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** @type {[string, RegExp | null][]} */
const PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Razorpay live key', /rzp_live_[A-Za-z0-9]{8,}/],
  ['AWS / Spaces style access key', /\b(?:AKIA|DO00)[A-Z0-9]{16,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Expo access token', /\bexpo_[A-Za-z0-9]{32,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['.env file committed', null],
];
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];
for (const f of files) {
  if (/(^|\/)\.env$/.test(f)) problems.push(`${f}: .env file committed`);
  if (/\.(png|jpe?g|webp|gif|ico|ttf|otf|woff2?|lock|hbc)$/i.test(f) || f.endsWith('pnpm-lock.yaml'))
    continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) if (re && re.test(text)) problems.push(`${f}: looks like a ${name}`);
}
if (problems.length) {
  console.error(`✗ possible secrets in tracked files:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ no secrets found in ${files.length} tracked files`);
