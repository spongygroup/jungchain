import 'dotenv/config';
import { fal } from '@fal-ai/client';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

fal.config({ credentials: process.env.FAL_KEY! });

const PHOTO_DIR = 'data/relay-photos/2026-02-15T13-03-13';
const OUT_DIR = 'data/stickers-test';

// Only re-segment these two with specific prompts
const targets = [
  { file: '17-Anchorage.jpg', city: 'Anchorage', prompt: 'salmon fillet' },
  { file: '06-Moscow.jpg', city: 'Moscow', prompt: 'borscht soup' },
];

for (const t of targets) {
  const photoPath = join(PHOTO_DIR, t.file);
  const photoBuffer = readFileSync(photoPath);

  console.log(`📸 ${t.file} → prompt: "${t.prompt}"`);

  // Upload to fal
  console.log('  ☁️ Uploading...');
  const file = new File([photoBuffer], t.file, { type: 'image/jpeg' });
  const uploadedUrl = await fal.storage.upload(file);

  // SAM3 with specific prompt
  console.log(`  ✂️ Segmenting "${t.prompt}"...`);
  const result = await fal.subscribe('fal-ai/sam-3/image', {
    input: { image_url: uploadedUrl, prompt: t.prompt, apply_mask: true, output_format: 'png' },
  });

  const masks = (result.data as any).masks || [];
  if (masks.length > 0 && masks[0].url) {
    const res = await fetch(masks[0].url);
    const buf = Buffer.from(await res.arrayBuffer());
    const outPath = join(OUT_DIR, `${t.city}.png`);
    writeFileSync(outPath, buf);
    console.log(`  ✅ Saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
  } else {
    console.log(`  ❌ No masks returned`);
  }
  console.log('');
}

console.log('Done!');
