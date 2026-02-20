/**
 * 완주 앨범 동적 생성기
 * 체인 데이터에서 자체완결형 HTML 앨범을 생성한다.
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { Bot } from 'grammy';
import { getChain, getAllBlocks, getUser } from '../db/database.js';
import { getCity, getFlag } from '../config.js';
import { translateContent } from './ai.js';
import { getFileBuffer } from './telegram.js';
import { tAsync } from './i18n.js';

const TMP_DIR = '/tmp/jung-album';

// ─── Main export ───

export async function generateAlbumHtml(
  bot: Bot,
  chainId: number,
  variant: number,
  recipientLang: string,
): Promise<Buffer> {
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found`);

  const blocks = getAllBlocks(chainId);
  if (blocks.length === 0) throw new Error(`Chain ${chainId} has no blocks`);

  const creator = getUser(chain.creator_id);

  // 1) Download photos + convert to WebP (batch parallel)
  const photoMap = await processPhotos(bot, blocks);

  // 2) Translate captions where needed
  const translationMap = await translateCaptions(blocks, recipientLang);

  // 3) Translate hero subtitle + footer
  const [subtitle, footer] = await Promise.all([
    tAsync(recipientLang, 'album_subtitle'),
    tAsync(recipientLang, 'album_footer'),
  ]);

  // 4) Build NFT SVG
  const jungChar = variant === 1 ? '\uC815' : '\u60C5'; // 정 or 情
  const svg = buildNftSvg(chainId, jungChar, chain.creator_tz, blocks.length);

  // 5) Assemble HTML
  const cards = blocks.map(b => {
    const user = getUser(b.user_id);
    const firstName = user?.first_name ?? 'Anonymous';
    const flag = getFlag(b.tz_offset);
    const city = user?.city || getCity(b.tz_offset);
    const time = formatSlotTime(b.created_at, b.tz_offset);
    const sign = b.tz_offset >= 0 ? '+' : '';
    const photoB64 = photoMap.get(b.id);
    const translation = translationMap.get(b.id);

    return buildCardHtml(
      b.slot_index,
      firstName,
      flag,
      city,
      `${time} (UTC${sign}${b.tz_offset})`,
      photoB64,
      b.content,
      translation,
    );
  }).join('\n');

  const heroTitle = `Soulbound NFT — Proof of ${jungChar}`;

  const html = `<!DOCTYPE html>
<html lang="${recipientLang}">
<head>
<script>document.documentElement.classList.add('js');</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${jungChar} Jung Chain #${chainId}</title>
<style>
${ALBUM_CSS}
</style>
</head>
<body>

<div class="nft-hero">
  ${svg}
  <h1>${escHtml(heroTitle)}</h1>
  <div class="subtitle">${escHtml(subtitle)}</div>
  <div class="nft-details">
    <div>Chain <span>#${chainId}</span></div>
    <div>Blocks <span>${blocks.length}/24</span></div>
    <div>Network <span>Base L2</span></div>
  </div>
  <div class="divider"></div>
</div>

<div class="chain">
${cards}
</div>

<div class="footer">
  <p>${escHtml(footer)}</p>
  <p style="margin-top: 2rem; font-size: 0.8rem; color: #333;">jungchain &copy; 2026</p>
</div>

${ALBUM_SCRIPT}
</body>
</html>`;

  return Buffer.from(html, 'utf-8');
}

// ─── Photo pipeline ───

async function processPhotos(bot: Bot, blocks: any[]): Promise<Map<number, string>> {
  const photoBlocks = blocks.filter(b => b.media_url && b.media_type === 'photo');
  const results = new Map<number, string>();
  if (photoBlocks.length === 0) return results;

  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  const CONCURRENCY = 4;
  for (let i = 0; i < photoBlocks.length; i += CONCURRENCY) {
    const batch = photoBlocks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (b) => {
        try {
          const base64 = await downloadAndConvertPhoto(bot, b.media_url);
          return [b.id, base64] as const;
        } catch (e: any) {
          console.error(`  📸 Photo download failed for block ${b.id}: ${e.message}`);
          return [b.id, null] as const;
        }
      })
    );
    for (const [id, b64] of batchResults) {
      if (b64) results.set(id as number, b64 as string);
    }
  }

  // Cleanup tmp dir
  try { rmSync(TMP_DIR, { recursive: true }); } catch {}

  return results;
}

async function downloadAndConvertPhoto(bot: Bot, fileId: string): Promise<string> {
  const buffer = await getFileBuffer(bot, fileId);
  const basename = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath = join(TMP_DIR, `${basename}.jpg`);
  const outputPath = join(TMP_DIR, `${basename}.webp`);

  writeFileSync(inputPath, buffer);

  try {
    execSync(`cwebp -q 50 -resize 500 0 "${inputPath}" -o "${outputPath}" 2>/dev/null`);
    const webpBuffer = readFileSync(outputPath);
    return webpBuffer.toString('base64');
  } catch {
    // Fallback: embed original as jpeg
    return buffer.toString('base64');
  } finally {
    try { rmSync(inputPath); } catch {}
    try { rmSync(outputPath); } catch {}
  }
}

// ─── Caption translation ───

async function translateCaptions(
  blocks: any[],
  recipientLang: string,
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  const LANG_NAMES: Record<string, string> = {
    ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese',
    th: 'Thai', es: 'Spanish', pt: 'Portuguese', fr: 'French',
    ar: 'Arabic', ru: 'Russian', de: 'German', it: 'Italian',
    tr: 'Turkish', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', uk: 'Ukrainian',
  };
  const targetLangName = LANG_NAMES[recipientLang] ?? 'English';

  const toTranslate = blocks.filter(b => {
    if (!b.content) return false;
    const writer = getUser(b.user_id);
    const writerLang = writer?.lang ?? 'en';
    return writerLang !== recipientLang;
  });

  const CONCURRENCY = 4;
  for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
    const batch = toTranslate.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (b) => {
        try {
          const translated = await translateContent([b.content], targetLangName);
          return [b.id, translated] as const;
        } catch {
          return [b.id, null] as const;
        }
      })
    );
    for (const [id, text] of batchResults) {
      if (text) results.set(id as number, text as string);
    }
  }

  return results;
}

// ─── NFT SVG builder ───

function buildNftSvg(
  chainId: number,
  jungChar: string,
  creatorTz: number,
  blockCount: number,
): string {
  const sign = creatorTz >= 0 ? '+' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#1a1a2e"/>
<text x="200" y="120" text-anchor="middle" font-size="80" fill="#e94560">${jungChar}</text>
<text x="200" y="180" text-anchor="middle" font-size="20" fill="#eee" font-family="monospace">JUNG #${chainId}</text>
<text x="200" y="220" text-anchor="middle" font-size="16" fill="#888" font-family="monospace">UTC${sign}${creatorTz} | slot ${blockCount}/24</text>
<text x="200" y="260" text-anchor="middle" font-size="14" fill="#888" font-family="monospace">${blockCount} blocks around the world</text>
<text x="200" y="320" text-anchor="middle" font-size="12" fill="#555" font-family="monospace">Proof of Jung</text>
<text x="200" y="345" text-anchor="middle" font-size="10" fill="#444" font-family="monospace">soulbound / non-transferable</text>
</svg>`;
}

// ─── Card HTML builder ───

function buildCardHtml(
  slotIndex: number,
  firstName: string,
  flag: string,
  city: string,
  timeStr: string,
  photoBase64: string | undefined,
  content: string,
  translation: string | undefined,
): string {
  const imgTag = photoBase64
    ? `<img src="data:image/webp;base64,${photoBase64}">`
    : '';
  const textOnlyClass = photoBase64 ? '' : ' text-only';
  const captionHtml = content
    ? `<div class="caption original">${escHtml(content)}</div>`
    : '';
  const translationHtml = translation
    ? `<div class="caption translated">${escHtml(translation)}</div>`
    : '';

  return `    <div class="card${textOnlyClass}">
      <div class="num">#${slotIndex}</div>
      ${imgTag}
      <div class="info">
        <div class="city-row">
          <div class="city">${escHtml(firstName)} &middot; ${flag} ${escHtml(city)}</div>
          <div class="city-time">${escHtml(timeStr)}</div>
        </div>
        <div class="caption-wrap">
          ${captionHtml}
          ${translationHtml}
        </div>
      </div>
    </div>`;
}

// ─── Helpers ───

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSlotTime(createdAt: string, tzOffset: number): string {
  const utc = new Date(createdAt.endsWith('Z') ? createdAt : createdAt + 'Z');
  const local = new Date(utc.getTime() + tzOffset * 60 * 60 * 1000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Static CSS (from demo template) ───

const ALBUM_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow-x: hidden;
  }
  .chain {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  .card {
    background: #111;
    border-radius: 16px;
    overflow: hidden;
    margin: 0 auto 1.5rem;
    max-width: 500px;
    opacity: 1;
    transform: translateY(0);
    position: relative;
  }
  .card.text-only .info {
    padding: 1.5rem 1.2rem;
    border-left: 3px solid #dc2626;
  }
  .js .card {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s, transform 0.6s;
  }
  .js .card.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .card .num {
    position: absolute;
    top: 12px; left: 12px;
    background: rgba(220,38,38,0.85);
    color: #fff;
    font-size: 0.75rem; font-weight: 700;
    padding: 4px 10px;
    border-radius: 100px;
    z-index: 2;
  }
  .card.text-only .num {
    position: static;
    display: inline-block;
    margin: 0 0 0.5rem 0;
  }
  .card img { width: 100%; display: block; }
  .card .info { padding: 1rem 1.2rem; }
  .card .city-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .card .city {
    font-size: 0.85rem;
    color: #dc2626;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  .card .city-time {
    font-size: 0.7rem;
    color: #666;
    font-weight: 400;
    white-space: nowrap;
  }
  .caption-wrap {
    position: relative;
    margin-top: 0.4rem;
  }
  .caption {
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .caption.original { color: #ccc; }
  .caption.translated {
    color: #999;
    font-size: 0.85rem;
    margin-top: 0.3rem;
    padding-top: 0.3rem;
    border-top: 1px solid #222;
  }
  .nft-hero {
    text-align: center;
    padding: 3rem 1rem 2rem;
    max-width: 600px;
    margin: 0 auto;
    opacity: 0;
    animation: heroIn 1.2s 0.3s forwards;
  }
  @keyframes heroIn { to { opacity: 1; } }
  .nft-hero svg {
    width: 288px; height: 288px;
    border-radius: 16px;
    box-shadow: 0 0 40px rgba(233,69,96,0.3);
  }
  .nft-hero h1 {
    font-size: 1.4rem; font-weight: 300;
    color: #e94560;
    margin-top: 1.5rem;
    letter-spacing: 0.05em;
  }
  .nft-hero .subtitle {
    font-size: 0.85rem;
    color: #666;
    margin-top: 0.5rem;
  }
  .nft-hero .nft-details {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-top: 1.2rem;
    font-size: 0.75rem;
    color: #555;
    font-family: monospace;
  }
  .nft-hero .nft-details span { color: #888; }
  .nft-hero .divider {
    width: 60px; height: 1px;
    background: #333;
    margin: 2rem auto 0;
  }
  .footer {
    text-align: center;
    padding: 4rem 1rem;
    color: #555;
  }
  .footer p { margin-top: 0.5rem; }
`;

// ─── Static JS (from demo template) ───

const ALBUM_SCRIPT = `<script>
function revealCards() {
  document.querySelectorAll('.card:not(.visible)').forEach(function(c) {
    var rect = c.getBoundingClientRect();
    if (rect.top < window.innerHeight * 1.1) {
      c.classList.add('visible');
    }
  });
}
setTimeout(function() {
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0 });
    document.querySelectorAll('.card').forEach(function(c) { observer.observe(c); });
  }
  revealCards();
  window.addEventListener('scroll', revealCards, { passive: true });
}, 1500);
</script>`;
