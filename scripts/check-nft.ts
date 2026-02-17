#!/usr/bin/env npx tsx
import { config } from 'dotenv'; config({ override: true });
import { jungSoulbound } from '../src/onchain.js';

const uri = await jungSoulbound.tokenURI(1);
const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
console.log('Name:', json.name);
console.log('Description:', json.description);

// Extract SVG
const svg = Buffer.from(json.image.split(',')[1], 'base64').toString();
console.log('\nSVG:');
console.log(svg);

// Save SVG
import { writeFileSync } from 'fs';
writeFileSync('data/nft-preview.svg', svg);
console.log('\n✅ Saved to data/nft-preview.svg');
