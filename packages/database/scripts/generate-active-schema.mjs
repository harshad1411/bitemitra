#!/usr/bin/env node
// Builds prisma/schema.prisma (the MIGRATED schema) from the long-term design
// (prisma/design/schema.design.prisma) and the list of active models (prisma/active-models.json).
//
//   * Active models are copied verbatim from the design, except relation fields that point to a
//     model which is not active yet (those relations appear when that table is activated).
//   * Only enums referenced by active models are included.
//   * constraints.sql statements are split into prisma/constraints.active.sql when every table they
//     touch is active.
//
// Usage: node scripts/generate-active-schema.mjs [--check]
//   --check  exit 1 if the generated files differ from what is on disk (used by CI / verify:schema).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const designPath = path.join(pkg, 'prisma/design/schema.design.prisma');
const activeListPath = path.join(pkg, 'prisma/active-models.json');
const outSchema = path.join(pkg, 'prisma/schema.prisma');
const constraintsPath = path.join(pkg, 'prisma/constraints.sql');
const outConstraints = path.join(pkg, 'prisma/constraints.active.sql');

/**
 * Splits a Prisma schema into top-level blocks, keeping each block's leading comment lines.
 * @param {string} text
 */
export function parseBlocks(text) {
  const lines = text.split('\n');
  /** @type {{ kind: string, name: string, lines: string[], leading: string[] }[]} */
  const blocks = [];
  let pendingComments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^(model|enum|generator|datasource)\s+(\w+)\s*\{/.exec(line);
    if (open) {
      const body = [line];
      while (!/^\}/.test(lines[i])) body.push(lines[++i]);
      blocks.push({ kind: open[1], name: open[2], lines: body, leading: pendingComments });
      pendingComments = [];
    } else if (/^\/\/\//.test(line)) {
      pendingComments.push(line);
    } else {
      pendingComments = [];
    }
  }
  return blocks;
}

/**
 * @param {string} line a field line inside a model
 * @returns {{ name: string, baseType: string } | null}
 */
export function parseField(line) {
  const m = /^\s+(\w+)\s+([\w]+)(\[\])?(\?)?/.exec(line);
  if (!m || line.trim().startsWith('@@') || line.trim().startsWith('//')) return null;
  return { name: m[1], baseType: m[2] };
}

export async function generate() {
  const design = await readFile(designPath, 'utf8');
  const active = new Set(JSON.parse(await readFile(activeListPath, 'utf8')).models);
  const blocks = parseBlocks(design);
  const modelNames = new Set(blocks.filter((b) => b.kind === 'model').map((b) => b.name));
  const enumNames = new Set(blocks.filter((b) => b.kind === 'enum').map((b) => b.name));

  for (const name of active) {
    if (!modelNames.has(name)) throw new Error(`active-models.json lists unknown model "${name}"`);
  }

  const usedEnums = new Set();
  const tables = new Set();
  const out = [];
  for (const block of blocks.filter((b) => b.kind === 'model' && active.has(b.name))) {
    const kept = [];
    let pendingDoc = [];
    for (const line of block.lines) {
      if (/^\s+\/\/\//.test(line)) {
        pendingDoc.push(line);
        continue;
      }
      const field = parseField(line);
      if (field && modelNames.has(field.baseType) && !active.has(field.baseType)) {
        pendingDoc = []; // drop the relation and its doc comment
        continue;
      }
      if (field && enumNames.has(field.baseType)) usedEnums.add(field.baseType);
      const map = /@@map\("(\w+)"\)/.exec(line);
      if (map) tables.add(map[1]);
      kept.push(...pendingDoc, line);
      pendingDoc = [];
    }
    out.push([...block.leading, ...kept].join('\n'));
  }

  const header = blocks
    .filter((b) => b.kind === 'generator' || b.kind === 'datasource')
    .map((b) => b.lines.join('\n'));
  const enums = blocks
    .filter((b) => b.kind === 'enum' && usedEnums.has(b.name))
    .map((b) => [...b.leading, ...b.lines].join('\n'));

  const schema = [
    '// GENERATED FILE — do not edit by hand.',
    '// Source: prisma/design/schema.design.prisma + prisma/active-models.json',
    '// Regenerate: pnpm --filter @jamzo/database schema:generate',
    '// These are the tables that are actually migrated (docs/DATABASE.md §3, DECISIONS D-18).',
    '',
    ...header.flatMap((h) => [h, '']),
    ...enums.flatMap((e) => [e, '']),
    ...out.flatMap((m) => [m, '']),
  ].join('\n');

  // Split constraints.sql into statements and keep those whose tables are all active.
  const sql = await readFile(constraintsPath, 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim());
  const activeStatements = statements.filter((stmt) => {
    const body = stmt.replace(/--.*$/gm, '');
    const refs = [...body.matchAll(/(?:ON|ALTER TABLE)\s+"?(\w+)"?/g)].map((m) => m[1]);
    return refs.length > 0 && refs.every((t) => tables.has(t));
  });
  const constraints = [
    '-- GENERATED FILE — do not edit by hand. Source: prisma/constraints.sql filtered to active tables.',
    '-- Applied as a hand-written migration after the generated Prisma migration.',
    '',
    ...activeStatements.map((s) => `${s.replace(/^(--[^\n]*\n)+/, '')};\n`),
  ].join('\n');

  return {
    schema,
    constraints,
    activeCount: active.size,
    enumCount: usedEnums.size,
    constraintCount: activeStatements.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const result = await generate();
  if (check) {
    const [a, b] = await Promise.all([
      readFile(outSchema, 'utf8').catch(() => ''),
      readFile(outConstraints, 'utf8').catch(() => ''),
    ]);
    if (a !== result.schema || b !== result.constraints) {
      console.error(
        '✗ prisma/schema.prisma or constraints.active.sql is out of date — run: pnpm --filter @jamzo/database schema:generate',
      );
      process.exit(1);
    }
    console.log(
      `✓ active schema up to date (${result.activeCount} models, ${result.enumCount} enums, ${result.constraintCount} constraints)`,
    );
  } else {
    await writeFile(outSchema, result.schema);
    await writeFile(outConstraints, result.constraints);
    console.log(
      `✓ wrote schema.prisma (${result.activeCount} models, ${result.enumCount} enums) and constraints.active.sql (${result.constraintCount} statements)`,
    );
  }
}
