import 'dotenv/config';
import sharp from 'sharp';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { TZ_FLAGS } from '../src/config.js';

const PHOTO_DIR = 'data/relay-photos/2026-02-15T13-03-13';
const CUTOUT_DIR = 'data/stickers-test';

const photos = readdirSync(PHOTO_DIR).filter(f => f.endsWith('.jpg')).sort();

interface PuzzlePiece {
  city: string;
  stickerB64: string;  // cutout PNG
  holeB64: string;     // background with hole
  originalB64: string; // full original photo
  caption: string;     // photographer's caption
  slotIndex: number;   // original order (1-based)
}

const pieces: PuzzlePiece[] = [];

for (const f of photos) {
  const city = f.replace(/^\d+-/, '').replace('.jpg', '');
  const cutoutPath = join(CUTOUT_DIR, `${city}.png`);

  let cutout: Buffer;
  try { cutout = readFileSync(cutoutPath); } catch { continue; }

  const original = readFileSync(join(PHOTO_DIR, f));

  // Read caption + offset from JSON metadata
  let caption = '';
  let offset = 0;
  try {
    const meta = JSON.parse(readFileSync(join(PHOTO_DIR, f.replace('.jpg', '.json')), 'utf-8'));
    caption = meta.caption || '';
    offset = meta.offset ?? 0;
  } catch {}

  // City name with flag emoji
  const flag = TZ_FLAGS[offset] ?? '🌍';
  const cityWithFlag = `${flag} ${city}`;

  const origMeta = await sharp(original).metadata();

  // Hole: punch subject out of original
  const resizedCutout = await sharp(cutout)
    .resize(origMeta.width!, origMeta.height!, { fit: 'fill' })
    .png().toBuffer();

  const holed = await sharp(original)
    .ensureAlpha()
    .composite([{ input: resizedCutout, blend: 'dest-out' as any }])
    .png().toBuffer();

  // Resize for embedding
  const stickerSmall = await sharp(cutout).resize(150, null, { withoutEnlargement: true }).png().toBuffer();
  const holeSmall = await sharp(holed).resize(150, null, { withoutEnlargement: true }).png().toBuffer();
  const origSmall = await sharp(original).resize(500, null, { withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();

  pieces.push({
    city: cityWithFlag,
    stickerB64: stickerSmall.toString('base64'),
    holeB64: holeSmall.toString('base64'),
    originalB64: origSmall.toString('base64'),
    caption,
    slotIndex: pieces.length + 1,
  });

  console.log(`✅ ${city}`);
}

console.log(`\n🧩 Building puzzle (${pieces.length} pieces)...`);

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0a0f; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; touch-action: none; user-select: none; -webkit-user-select: none; }

#header {
  position: fixed; top: 0; left: 0; right: 0;
  padding: 12px 16px; font-size: 14px; color: rgba(255,255,255,0.4);
  background: linear-gradient(to bottom, rgba(10,10,15,0.95) 60%, transparent);
  z-index: 200; pointer-events: none; text-align: center;
}
#title { color: #e94560; }
#score { color: rgba(255,255,255,0.4); }
#round { color: rgba(255,255,255,0.3); }
.dot { margin: 0 6px; color: rgba(255,255,255,0.2); }

#field { position: fixed; top: 40px; left: 0; right: 0; bottom: 90px; overflow: hidden; }

.piece {
  position: absolute;
  animation: float 6s ease-in-out infinite;
  cursor: grab;
  transition: opacity 0.3s, filter 0.3s, transform 0.3s;
  filter: drop-shadow(0 3px 10px rgba(0,0,0,0.5));
}
.piece img { width: 100%; height: auto; pointer-events: none; border-radius: 8px; -webkit-user-drag: none; }
.piece.is-sticker img { border-radius: 0; }
.piece.is-hole { cursor: default; }
.piece.is-hole img { border: 2px solid rgba(255,255,255,0.25); border-radius: 10px; }
.piece.faded { opacity: 0; pointer-events: none; }
.piece.dragging {
  animation: none !important; cursor: grabbing;
  z-index: 100; transform: scale(1.15) rotate(0deg) !important;
  filter: drop-shadow(0 0 20px rgba(233,69,96,0.6));
  transition: none;
}
.piece.hover-target {
  filter: drop-shadow(0 0 18px rgba(34,197,94,0.7)) !important;
  transform: scale(1.08) !important;
}
.piece.matched {
  transition: transform 0.4s, opacity 0.4s;
  transform: scale(0) !important; opacity: 0;
  pointer-events: none;
}
.piece.wrong { animation: shake 0.4s !important; }
.piece.entering {
  animation: enterPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(var(--r, 0deg)); }
  25% { transform: translateY(-10px) rotate(calc(var(--r, 0deg) + 2deg)); }
  50% { transform: translateY(-5px) rotate(calc(var(--r, 0deg) - 2deg)); }
  75% { transform: translateY(-14px) rotate(calc(var(--r, 0deg) + 1deg)); }
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
@keyframes enterPop {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

#reveal {
  display: none; position: fixed; inset: 0; z-index: 300;
  background: rgba(10,10,15,0.92);
  flex-direction: column; align-items: center; justify-content: center;
}
#reveal.show { display: flex; }
#reveal img {
  max-width: 80%; max-height: 50vh; border-radius: 14px;
  box-shadow: 0 8px 40px rgba(233,69,96,0.3);
  animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
#reveal-city {
  margin-top: 14px; font-size: 17px; color: rgba(255,255,255,0.7);
  animation: popIn 0.5s 0.1s both;
}
@keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

#shelf {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: linear-gradient(to top, rgba(10,10,15,0.98), rgba(10,10,15,0.85));
  border-top: 1px solid #1a1a2e;
  height: 80px; padding: 6px 10px;
  display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch;
  z-index: 100; align-items: center;
}
.shelf-item {
  flex-shrink: 0; width: 50px; height: 50px;
  border-radius: 6px; overflow: hidden; border: 1px solid #22c55e;
  animation: popIn 0.4s;
}
.shelf-item img { width: 100%; height: 100%; object-fit: cover; }

/* ── Album (completion view) ── */
#album {
  display: none; position: fixed; inset: 0; z-index: 500;
  background: #0a0a0a;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
#album.show { display: block; }

.album-hero {
  text-align: center;
  padding: 3rem 1rem 1.5rem;
  opacity: 0;
  animation: heroFadeIn 1.2s 0.3s forwards;
}
.jung-glyph {
  font-size: 4.5rem;
  color: #e94560;
  text-shadow: 0 0 40px rgba(233,69,96,0.5), 0 0 80px rgba(233,69,96,0.2);
  animation: glyphPulse 3s ease-in-out infinite;
  line-height: 1;
}
.album-hero h1 {
  font-size: 1.3rem; font-weight: 300;
  color: #e94560;
  margin-top: 0.8rem;
  letter-spacing: 0.08em;
}
.album-hero .hero-sub {
  font-size: 0.8rem;
  color: #555;
  margin-top: 0.5rem;
}
.album-hero .hero-stats {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-top: 1rem;
  font-size: 0.7rem;
  color: #444;
  font-family: monospace;
}
.album-hero .hero-stats span { color: #777; }
.album-hero .hero-divider {
  width: 60px; height: 1px;
  background: linear-gradient(90deg, transparent, #333, transparent);
  margin: 1.5rem auto 0;
}

@keyframes heroFadeIn { to { opacity: 1; } }
@keyframes glyphPulse {
  0%, 100% { text-shadow: 0 0 40px rgba(233,69,96,0.5), 0 0 80px rgba(233,69,96,0.2); }
  50% { text-shadow: 0 0 60px rgba(233,69,96,0.7), 0 0 120px rgba(233,69,96,0.3); }
}

.album-grid {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.5rem;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(4, 1fr);
}
@media (max-width: 768px) {
  .album-grid { grid-template-columns: repeat(3, 1fr); gap: 0.4rem; }
  .album-hero { padding: 2rem 1rem 1rem; }
  .jung-glyph { font-size: 3.5rem; }
  .album-hero h1 { font-size: 1.1rem; }
}

.album-card {
  background: #111;
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  opacity: 0;
  transform: translateY(20px);
  transition: transform 0.2s, box-shadow 0.2s;
}
.album-card.visible {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.5s ease, transform 0.5s ease, box-shadow 0.2s;
}
.album-card:active {
  transform: scale(0.97);
}
.album-card .slot-num {
  position: absolute;
  top: 5px; left: 5px;
  background: rgba(233,69,96,0.85);
  color: #fff;
  font-size: 0.55rem; font-weight: 700;
  padding: 2px 7px;
  border-radius: 100px;
  z-index: 2;
}
.album-card img {
  width: 100%; display: block;
  aspect-ratio: 1;
  object-fit: cover;
}
.album-card .card-info {
  padding: 0.35rem 0.45rem 0.45rem;
}
.album-card .card-city {
  font-size: 0.6rem;
  color: #e94560;
  font-weight: 600;
  letter-spacing: 0.03em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.album-card .card-caption {
  font-size: 0.5rem;
  color: #888;
  margin-top: 0.15rem;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Lightbox (card expand) ── */
#lightbox {
  display: none; position: fixed; inset: 0; z-index: 600;
  background: rgba(0,0,0,0.92);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  cursor: pointer;
}
#lightbox.show { display: flex; }
#lightbox img {
  max-width: 90%; max-height: 60vh;
  border-radius: 14px;
  box-shadow: 0 12px 60px rgba(233,69,96,0.25);
  animation: lbIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
#lightbox .lb-city {
  margin-top: 1rem;
  font-size: 1.1rem;
  color: #e94560;
  font-weight: 600;
  animation: lbIn 0.4s 0.05s both;
}
#lightbox .lb-caption {
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: #999;
  max-width: 400px;
  text-align: center;
  line-height: 1.5;
  animation: lbIn 0.4s 0.1s both;
}
#lightbox .lb-slot {
  margin-top: 0.6rem;
  font-size: 0.65rem;
  color: #444;
  font-family: monospace;
  animation: lbIn 0.4s 0.15s both;
}
@keyframes lbIn {
  from { transform: scale(0.7) translateY(10px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

.album-footer {
  text-align: center;
  padding: 2rem 1rem 3rem;
}
.album-footer .footer-jung {
  font-size: 1.5rem;
  color: #e94560;
  text-shadow: 0 0 20px rgba(233,69,96,0.3);
}
.album-footer .footer-text {
  font-size: 0.75rem;
  color: #444;
  margin-top: 0.5rem;
  letter-spacing: 0.05em;
}
.album-footer .footer-copy {
  font-size: 0.6rem;
  color: #333;
  margin-top: 1rem;
}
`;

const ENGINE = `
(function() {
  var field = document.getElementById('field');
  var reveal = document.getElementById('reveal');
  var revealImg = document.getElementById('reveal-img');
  var revealCity = document.getElementById('reveal-city');
  var shelf = document.getElementById('shelf');
  var scoreEl = document.getElementById('score');
  var roundEl = document.getElementById('round');

  var total = PIECES.length;
  var isMobile = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
  var BATCH = isMobile ? 12 : total;
  var totalMatched = 0;
  var roundIdx = 0;
  var drag = null;
  var curEls = {};
  var roundMatched = 0;

  // shuffle helper
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // shuffled order of piece indices
  var order = shuffle(PIECES.map(function(_, i) { return i; }));
  var totalRounds = Math.ceil(order.length / BATCH);

  function placePieces(ids) {
    // clear field
    field.innerHTML = '';
    curEls = {};
    roundMatched = 0;
    drag = null;

    var items = [];
    var sIds = shuffle(ids.slice());
    var hIds = shuffle(ids.slice());
    sIds.forEach(function(id) { items.push({ type: 'sticker', id: id }); });
    hIds.forEach(function(id) { items.push({ type: 'hole', id: id }); });
    items = shuffle(items);

    var fr = field.getBoundingClientRect();
    var W = fr.width, H = fr.height;
    var pieceSize = isMobile ? Math.min(90, Math.floor(W / 5)) : Math.min(140, Math.floor(W / 7));
    var floatRange = 16;
    var pieceH = Math.round(pieceSize * 1.4);
    var cols = Math.floor(W / (pieceSize + 8));
    var rows = Math.ceil(items.length / cols);
    var cellW = W / cols;
    var cellH = H / Math.max(rows, 1);

    items.forEach(function(item, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var el = document.createElement('div');
      el.className = 'piece entering ' + (item.type === 'sticker' ? 'is-sticker' : 'is-hole');
      el.style.width = pieceSize + 'px';
      el.dataset.type = item.type;
      el.dataset.id = String(item.id);
      var img = document.createElement('img');
      img.src = item.type === 'sticker' ? PIECES[item.id].sticker : PIECES[item.id].hole;
      el.appendChild(img);

      // clamp: keep entire piece + float animation inside field
      var maxX = W - pieceSize - 4;
      var maxY = H - pieceH - floatRange;
      var cx = col * cellW + (Math.random() * 0.3 + 0.05) * cellW;
      var cy = row * cellH + (Math.random() * 0.3 + 0.05) * cellH;
      el.style.left = Math.max(4, Math.min(cx, maxX)) + 'px';
      el.style.top = Math.max(floatRange, Math.min(cy, maxY)) + 'px';

      el.style.setProperty('--r', (Math.random() * 12 - 6).toFixed(0) + 'deg');
      el.style.animationDelay = (Math.random() * 3).toFixed(1) + 's';
      el.style.animationDuration = (4 + Math.random() * 3).toFixed(1) + 's';
      // remove entering class after animation
      setTimeout(function() { el.classList.remove('entering'); }, 500);

      field.appendChild(el);
      curEls[item.type + '-' + item.id] = el;
    });
  }

  function startRound() {
    var start = roundIdx * BATCH;
    var ids = order.slice(start, start + BATCH);
    if (ids.length === 0) return;
    roundEl.textContent = 'R' + (roundIdx + 1) + '/' + totalRounds;
    placePieces(ids);
  }

  function nextRound() {
    roundIdx++;
    if (roundIdx * BATCH >= order.length) {
      // all done — show album!
      setTimeout(showAlbum, 800);
      return;
    }
    setTimeout(startRound, 600);
  }

  function showAlbum() {
    field.innerHTML = '';
    shelf.style.display = 'none';
    document.getElementById('header').style.display = 'none';

    var album = document.getElementById('album');
    var lightbox = document.getElementById('lightbox');
    var sorted = PIECES.slice().sort(function(a, b) { return a.slot - b.slot; });

    // Hero
    var html = '<div class="album-hero">';
    html += '<div class="jung-glyph">\u60C5</div>';
    html += '<h1>Proof of \uC815</h1>';
    html += '<div class="hero-sub">' + total + ' moments \u00B7 24 timezones \u00B7 1 relay</div>';
    html += '<div class="hero-stats">';
    html += '<div>Blocks <span>' + total + '/24</span></div>';
    html += '<div>Cities <span>' + total + '</span></div>';
    html += '<div>Network <span>Base L2</span></div>';
    html += '</div>';
    html += '<div class="hero-divider"></div>';
    html += '</div>';

    // Grid
    html += '<div class="album-grid">';
    sorted.forEach(function(p, i) {
      var cap = p.caption ? p.caption.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
      html += '<div class="album-card" data-idx="' + i + '">';
      html += '<span class="slot-num">#' + p.slot + '</span>';
      html += '<img src="' + p.original + '" alt="' + p.city + '">';
      html += '<div class="card-info">';
      html += '<div class="card-city">' + p.city + '</div>';
      if (cap) html += '<div class="card-caption">' + cap + '</div>';
      html += '</div></div>';
    });
    html += '</div>';

    // Footer
    html += '<div class="album-footer">';
    html += '<div class="footer-jung">\uC815</div>';
    html += '<div class="footer-text">a relay of warmth across the world</div>';
    html += '<div class="footer-copy">jungchain \u00A9 2026</div>';
    html += '</div>';

    album.innerHTML = html;
    album.classList.add('show');

    // Scroll reveal cards
    var cards = album.querySelectorAll('.album-card');
    function revealCards() {
      cards.forEach(function(c) {
        if (c.classList.contains('visible')) return;
        var r = c.getBoundingClientRect();
        if (r.top < window.innerHeight * 1.05) c.classList.add('visible');
      });
    }
    setTimeout(revealCards, 400);
    album.addEventListener('scroll', revealCards, { passive: true });

    // Card tap → lightbox
    album.addEventListener('click', function(e) {
      var card = (e.target || e.srcElement).closest('.album-card');
      if (!card) return;
      var idx = Number(card.dataset.idx);
      var p = sorted[idx];
      if (!p) return;

      var lbImg = lightbox.querySelector('img');
      var lbCity = lightbox.querySelector('.lb-city');
      var lbCap = lightbox.querySelector('.lb-caption');
      var lbSlot = lightbox.querySelector('.lb-slot');
      lbImg.src = p.original;
      lbCity.textContent = p.city;
      lbCap.textContent = p.caption || '';
      lbCap.style.display = p.caption ? '' : 'none';
      lbSlot.textContent = '#' + p.slot + ' / ' + total;
      lightbox.classList.add('show');
    });

    lightbox.addEventListener('click', function() {
      lightbox.classList.remove('show');
    });
  }

  // --- drag & drop ---
  function getXY(e) {
    var t = e.touches ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
    return { x: t.clientX, y: t.clientY };
  }

  function unfadeAll() {
    Object.keys(curEls).forEach(function(key) {
      if (curEls[key]) curEls[key].classList.remove('faded');
    });
  }

  function onStart(e) {
    var piece = (e.target || e.srcElement).closest('.piece');
    if (!piece || piece.dataset.type !== 'sticker' || piece.classList.contains('matched')) return;
    e.preventDefault();
    unfadeAll();
    var pt = getXY(e);
    var rect = piece.getBoundingClientRect();
    drag = {
      el: piece, id: Number(piece.dataset.id),
      ox: pt.x - rect.left, oy: pt.y - rect.top,
      origLeft: piece.style.left, origTop: piece.style.top
    };
    piece.classList.add('dragging');
    Object.keys(curEls).forEach(function(key) {
      var el = curEls[key];
      if (!el || el.classList.contains('matched')) return;
      if (key.startsWith('sticker-') && key !== 'sticker-' + drag.id) {
        el.classList.add('faded');
      }
    });
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    var pt = getXY(e);
    drag.el.style.left = (pt.x - drag.ox) + 'px';
    drag.el.style.top = (pt.y - drag.oy) + 'px';
    var hit = findHoleAt(pt.x, pt.y);
    Object.keys(curEls).forEach(function(key) {
      if (key.startsWith('hole-') && curEls[key]) curEls[key].classList.remove('hover-target');
    });
    if (hit) hit.classList.add('hover-target');
  }

  function onEnd(e) {
    if (!drag) return;
    var pt = e.changedTouches ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : getXY(e);
    Object.keys(curEls).forEach(function(key) {
      if (key.startsWith('hole-') && curEls[key]) curEls[key].classList.remove('hover-target');
    });
    var hit = findHoleAt(pt.x, pt.y);
    if (hit) {
      var holeId = Number(hit.dataset.id);
      if (holeId === drag.id) {
        doMatch(drag.id, drag.el, hit);
      } else {
        hit.classList.add('wrong');
        setTimeout(function() { hit.classList.remove('wrong'); }, 500);
        resetDrag();
      }
    } else {
      resetDrag();
    }
  }

  function resetDrag() {
    if (!drag) return;
    drag.el.style.left = drag.origLeft;
    drag.el.style.top = drag.origTop;
    drag.el.classList.remove('dragging');
    Object.keys(curEls).forEach(function(key) {
      if (curEls[key]) curEls[key].classList.remove('faded');
    });
    drag = null;
  }

  function findHoleAt(x, y) {
    var found = null;
    Object.keys(curEls).forEach(function(key) {
      if (!key.startsWith('hole-')) return;
      var el = curEls[key];
      if (!el || el.classList.contains('matched')) return;
      var r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = el;
    });
    return found;
  }

  function doMatch(id, stickerEl, holeEl) {
    var p = PIECES[id];
    stickerEl.classList.remove('dragging');
    stickerEl.classList.add('matched');
    holeEl.classList.add('matched');

    // unfade others
    Object.keys(curEls).forEach(function(key) {
      if (curEls[key]) curEls[key].classList.remove('faded');
    });
    drag = null;

    // reveal
    revealImg.src = p.original; revealImg.style.display = '';
    revealCity.textContent = p.city;
    reveal.classList.add('show');

    // shelf
    var si = document.createElement('div'); si.className = 'shelf-item';
    var img = document.createElement('img'); img.src = p.original;
    si.appendChild(img); shelf.appendChild(si);

    totalMatched++;
    roundMatched++;
    scoreEl.textContent = totalMatched + '/' + total;

    setTimeout(function() {
      reveal.classList.remove('show');
      unfadeAll();
      // check round complete
      var batchSize = Math.min(BATCH, order.length - roundIdx * BATCH);
      if (roundMatched >= batchSize) {
        nextRound();
      }
    }, 1200);
  }

  // events
  field.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
  field.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  reveal.addEventListener('click', function() { reveal.classList.remove('show'); unfadeAll(); });

  // kick off — wait for layout to be ready
  scoreEl.textContent = '0/' + total;
  if (document.readyState === 'complete') {
    startRound();
  } else {
    window.addEventListener('load', startRound);
  }
})();
`;

// Embed data as JSON
const piecesJson = pieces.map((p, i) => ({
  id: i,
  city: p.city,
  sticker: `data:image/png;base64,${p.stickerB64}`,
  hole: `data:image/png;base64,${p.holeB64}`,
  original: `data:image/jpeg;base64,${p.originalB64}`,
  caption: p.caption,
  slot: p.slotIndex,
}));

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>정 Puzzle</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="header"><span id="title">정 퍼즐</span><span class="dot">·</span><span id="score">0/${pieces.length}</span><span class="dot">·</span><span id="round"></span></div>
<div id="field"></div>
<div id="reveal">
  <img id="reveal-img" src="">
  <div id="reveal-city"></div>
</div>
<div id="shelf"></div>
<div id="album"></div>
<div id="lightbox">
  <img src="">
  <div class="lb-city"></div>
  <div class="lb-caption"></div>
  <div class="lb-slot"></div>
</div>
<script>
var PIECES = ${JSON.stringify(piecesJson)};
${ENGINE}
</script>
</body>
</html>`;

const outPath = 'data/test-puzzle.html';
writeFileSync(outPath, html);
console.log(`✅ ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
try { execSync(`open ${outPath}`); } catch {}
