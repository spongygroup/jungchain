import 'dotenv/config';
import { writeFileSync } from 'fs';
import { config } from '../src/config.js';

const apiKey = config.googleApiKey;
const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${apiKey}`;

const prompts = [
  { name: 'tokyo', prompt: 'A warm bowl of ramen at a cozy Japanese izakaya, steam rising, chopsticks resting on the side, warm ambient lighting, close-up food photography' },
  { name: 'bangkok', prompt: 'A colorful Thai street food stall at night, pad thai being cooked in a wok with flames, neon signs in background, vibrant street photography' },
  { name: 'saopaulo', prompt: 'A cup of Brazilian coffee on a small table at a sidewalk cafe, morning sunlight, Sao Paulo street in background, warm tones, lifestyle photography' },
];

async function generate(p: typeof prompts[0]) {
  console.log(`Generating: ${p.name}...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: p.prompt }],
      parameters: { sampleCount: 1, aspectRatio: '9:16' },
    }),
  });
  const data = await res.json() as any;
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    console.error(`Failed for ${p.name}:`, JSON.stringify(data).slice(0, 300));
    return;
  }
  const path = `/tmp/jung-${p.name}.jpg`;
  writeFileSync(path, Buffer.from(b64, 'base64'));
  console.log(`  ✅ Saved: ${path} (${(b64.length * 0.75 / 1024).toFixed(0)}KB)`);
}

async function main() {
  for (const p of prompts) {
    await generate(p);
  }
  console.log('Done!');
}

main();
