#!/usr/bin/env node
// App icons, splash images and favicons from the owner's Jamzo logo kit (DECISIONS D-107). The kit in
// assets/brand/jamzo-logo-kit is kept exactly as delivered; this script only copies and resizes from it.
//
// Usage: node scripts/brand-assets.mjs
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MOBILE_APPS } from '@jamzo/config/apps';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'assets/brand/jamzo-logo-kit');
const k = (p) => path.join(kit, p);

for (const app of Object.values(MOBILE_APPS)) {
  const out = path.join(root, 'apps', app.slug, 'assets');
  await mkdir(out, { recursive: true });
  const o = (name) => path.join(out, name);
  await copyFile(k('4-app-icons/png/app-icon-1024.png'), o('icon.png')); // iOS rounds the corners itself
  await sharp(k('4-app-icons/png/android-adaptive-foreground.png'))
    .resize(1024, 1024)
    .png()
    .toFile(o('adaptive-icon-foreground.png'));
  await sharp(k('4-app-icons/png/android-adaptive-background.png'))
    .resize(1024, 1024)
    .png()
    .toFile(o('adaptive-icon-background.png'));
  // Android 13 themed icon and the notification icon: a one-colour silhouette on transparent.
  await sharp(k('3-icon-mark/png/jamzo-mark-mono-white.png'))
    .resize(640, 640)
    .extend({ top: 192, bottom: 192, left: 192, right: 192, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(o('adaptive-icon-monochrome.png'));
  await sharp(k('3-icon-mark/png/jamzo-mark-mono-white.png'))
    .resize(96, 96)
    .png()
    .toFile(o('notification-icon.png'));
  // Splash: the full logo, white on the navy splash background (packages/config/src/expo.js).
  await copyFile(k('1-logo-without-tagline/png/jamzo-logo-on-dark.png'), o('splash-icon.png'));
  await sharp(k('4-app-icons/png/favicon-192.png')).resize(48, 48).png().toFile(o('favicon.png'));
  // In-app logos (home header and sign-in).
  await copyFile(k('1-logo-without-tagline/png/jamzo-logo-on-dark.png'), o('logo-on-dark.png'));
  await copyFile(k('1-logo-without-tagline/png/jamzo-logo-on-light.png'), o('logo-on-light.png'));
  await sharp(k('3-icon-mark/png/jamzo-mark-mono-navy.png')).resize(256, 256).png().toFile(o('mark.png'));
  console.log(`✓ ${app.slug}: brand assets`);
}

const admin = path.join(root, 'apps/admin');
await copyFile(k('4-app-icons/svg/favicon-192.svg'), path.join(admin, 'public/favicon.svg'));
await copyFile(
  k('1-logo-without-tagline/svg/jamzo-logo-on-light.svg'),
  path.join(admin, 'public/jamzo-logo.svg'),
);
await copyFile(k('3-icon-mark/svg/jamzo-mark-navy.svg'), path.join(admin, 'public/jamzo-mark.svg'));
console.log('✓ admin: favicon and logos');
