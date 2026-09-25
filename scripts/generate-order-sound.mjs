#!/usr/bin/env node
// Generates the PLACEHOLDER new-order alert for the Restaurant Partner app (a two-tone chime, 16-bit mono WAV).
// Replace with the final brand sound when it exists (DECISIONS Q-13). Run: node scripts/generate-order-sound.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const RATE = 22_050;
const tones = [
  [880, 0.22],
  [0, 0.06],
  [660, 0.22],
  [0, 0.06],
  [880, 0.22],
  [0, 0.45],
];
const samples = [];
for (const [freq, secs] of tones) {
  const n = Math.round(RATE * secs);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 400, (n - i) / 400); // no clicks at tone edges
    samples.push(freq ? Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 0.6 * fade * 32767) : 0);
  }
}
const data = Buffer.alloc(samples.length * 2);
samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
const dir = new URL('../apps/restaurant/assets/sounds/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('new_order.wav', dir), Buffer.concat([header, data]));
console.log(
  `✓ wrote apps/restaurant/assets/sounds/new_order.wav (${((44 + data.length) / 1024).toFixed(0)} KB, placeholder)`,
);
