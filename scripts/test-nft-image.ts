import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateNftImage } from '../src/services/album.js';

const chainId = Number(process.argv[2] ?? 323);
const variant = Number(process.argv[3] ?? 0); // 0=情, 1=정

const png = await generateNftImage(chainId, variant);
const outPath = `/tmp/jung-nft-${chainId}-${variant}.png`;
writeFileSync(outPath, png);
console.log(`✅ ${outPath} (${png.length} bytes) — variant=${variant}`);
