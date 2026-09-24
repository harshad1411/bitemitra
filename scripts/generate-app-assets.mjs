#!/usr/bin/env node
// PLACEHOLDER app icons and splash images for the three mobile apps (DECISIONS D-16).
// No Jamzo logo exists yet (Q-13): each app gets a "J" monogram on its registry colour so the three apps
// are distinguishable. Replace with final brand assets when they exist, then re-run this script.
//
// Usage: node scripts/generate-app-assets.mjs
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MOBILE_APPS } from '@jamzo/config/apps';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** "J" drawn as a path (no font dependency, identical output on every machine). */
const J_PATH =
  'M 600 250 L 600 640 Q 600 800 450 800 Q 320 800 285 690 L 385 650 Q 400 700 450 700 Q 500 700 500 630 L 500 250 Z';

const svg = ({ size, bg, fg, rounded = false, inset = 0 }) => {
  const scale = (size * (1 - inset * 2)) / 1024;
  const offset = size * inset;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg ? `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${bg}"/>` : ''}
    <g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${J_PATH}" fill="${fg}"/></g>
  </svg>`);
};

for (const app of Object.values(MOBILE_APPS)) {
  const out = path.join(root, 'apps', app.slug, 'assets');
  await mkdir(out, { recursive: true });
  const write = (name, opts) => sharp(svg(opts)).png().toFile(path.join(out, name));
  await write('icon.png', { size: 1024, bg: app.color, fg: '#FFFFFF' }); // iOS: full-bleed, OS rounds corners
  await write('adaptive-icon-foreground.png', { size: 1024, fg: '#FFFFFF', inset: 0.18 }); // Android safe zone
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: app.color } })
    .png()
    .toFile(path.join(out, 'adaptive-icon-background.png'));
  await write('adaptive-icon-monochrome.png', { size: 1024, fg: '#FFFFFF', inset: 0.18 });
  await write('notification-icon.png', { size: 96, fg: '#FFFFFF' }); // Android: white on transparent
  await write('splash-icon.png', { size: 512, bg: app.color, fg: '#FFFFFF', rounded: true });
  await write('favicon.png', { size: 48, bg: app.color, fg: '#FFFFFF', rounded: true });
  console.log(`✓ ${app.slug}: placeholder assets (${app.color})`);
}
