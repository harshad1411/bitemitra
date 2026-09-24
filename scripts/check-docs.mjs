#!/usr/bin/env node
// Keeps the documentation set honest: every relative Markdown link must point to an existing file,
// and every #anchor must match a heading (GitHub slug rules). Also enforces the owner's
// JavaScript-only directive by failing on any .ts/.tsx file outside node_modules.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', '.turbo', '.next', 'dist']);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/** GitHub-style heading slug. */
function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(markdown) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const files = await walk(root);
const problems = [];

for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
  problems.push(`TypeScript file not allowed (JavaScript-only directive): ${path.relative(root, f)}`);
}

const mdFiles = files.filter((f) => f.endsWith('.md'));
const anchorCache = new Map();
const anchorsFor = async (file) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(await readFile(file, 'utf8')));
  return anchorCache.get(file);
};

let checked = 0;
for (const file of mdFiles) {
  const text = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked++;
    const [rel, anchor] = target.split('#');
    const dest = rel ? path.resolve(path.dirname(file), decodeURI(rel)) : file;
    const where = `${path.relative(root, file)} → ${target}`;
    try {
      await stat(dest);
    } catch {
      problems.push(`missing file: ${where}`);
      continue;
    }
    if (anchor && dest.endsWith('.md') && !(await anchorsFor(dest)).has(anchor)) {
      problems.push(`missing anchor: ${where}`);
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${mdFiles.length} Markdown files, ${checked} relative links/anchors resolve; no .ts/.tsx files`);
