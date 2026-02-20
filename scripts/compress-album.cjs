const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const input = 'data/red-chain-relay.html';
const output = 'data/red-chain-relay-light.html';
const tmpDir = '/tmp/album-compress';

// Clean & create temp dir
if (fs.existsSync(tmpDir)) execSync(`rm -rf ${tmpDir}`);
fs.mkdirSync(tmpDir, { recursive: true });

let html = fs.readFileSync(input, 'utf-8');

// Find all base64 images
const regex = /data:image\/jpeg;base64,([A-Za-z0-9+/=\n\r]+)/g;
let match;
let idx = 0;
const replacements = [];

while ((match = regex.exec(html)) !== null) {
  const b64 = match[1].replace(/[\n\r\s]/g, '');
  const buf = Buffer.from(b64, 'base64');
  const origPath = path.join(tmpDir, `img${idx}_orig.jpg`);
  const resizedPath = path.join(tmpDir, `img${idx}_resized.jpg`);

  fs.writeFileSync(origPath, buf);

  // Resize to max 800px width, JPEG quality via sips
  try {
    execSync(`sips --resampleWidth 500 --setProperty formatOptions 30 "${origPath}" --out "${resizedPath}" 2>/dev/null`);
  } catch {
    // fallback: just copy
    fs.copyFileSync(origPath, resizedPath);
  }

  const resizedBuf = fs.readFileSync(resizedPath);
  const resizedB64 = resizedBuf.toString('base64');

  replacements.push({
    original: match[0],
    replacement: 'data:image/jpeg;base64,' + resizedB64,
    origSize: buf.length,
    newSize: resizedBuf.length,
  });

  idx++;
  process.stdout.write(`\r  Processed ${idx} images...`);
}

console.log(`\n  Total images: ${idx}`);

// Apply replacements
for (const r of replacements) {
  html = html.replace(r.original, r.replacement);
}

fs.writeFileSync(output, html);

const origSize = fs.statSync(input).size;
const newSize = fs.statSync(output).size;
console.log(`  Original: ${(origSize / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Compressed: ${(newSize / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Saved: ${((1 - newSize / origSize) * 100).toFixed(0)}%`);

// Cleanup
execSync(`rm -rf ${tmpDir}`);
