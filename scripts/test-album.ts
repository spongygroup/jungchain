import 'dotenv/config';
import { Bot } from 'grammy';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { generateAlbumHtml } from '../src/services/album.js';

const chainId = Number(process.argv[2]) || 323;
const variant = Number(process.argv[3]) || 0; // 0=情, 1=정
const lang = process.argv[4] || 'ko';

const bot = new Bot(process.env.JUNG_BOT_TOKEN!);

async function main() {
  console.log(`Generating album for chain #${chainId} (variant=${variant}, lang=${lang})...`);
  const buffer = await generateAlbumHtml(bot, chainId, variant, lang);
  const outPath = `data/test-album-${chainId}.html`;
  writeFileSync(outPath, buffer);
  console.log(`Written to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
  try { execSync(`open ${outPath}`); } catch {}
}

main().catch(console.error);
