const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const input = 'data/red-chain-relay.html';
const output = 'data/red-chain-relay-webp.html';
const tmpDir = '/tmp/album-webp';

if (fs.existsSync(tmpDir)) execSync(`rm -rf ${tmpDir}`);
fs.mkdirSync(tmpDir, { recursive: true });

let html = fs.readFileSync(input, 'utf-8');

const regex = /data:image\/jpeg;base64,([A-Za-z0-9+/=\n\r]+)/g;
let match;
let idx = 0;
const replacements = [];

while ((match = regex.exec(html)) !== null) {
  const b64 = match[1].replace(/[\n\r\s]/g, '');
  const buf = Buffer.from(b64, 'base64');
  const origPath = path.join(tmpDir, `img${idx}.jpg`);
  const webpPath = path.join(tmpDir, `img${idx}.webp`);

  fs.writeFileSync(origPath, buf);
  execSync(`cwebp -q 50 "${origPath}" -o "${webpPath}" 2>/dev/null`);

  const webpBuf = fs.readFileSync(webpPath);
  replacements.push({
    original: match[0],
    replacement: 'data:image/webp;base64,' + webpBuf.toString('base64'),
    origSize: buf.length,
    newSize: webpBuf.length,
  });

  idx++;
  process.stdout.write(`\r  Processed ${idx} images...`);
}

console.log(`\n  Total images: ${idx}`);

for (const r of replacements) {
  html = html.replace(r.original, r.replacement);
}

fs.writeFileSync(output, html);

const origSize = fs.statSync(input).size;
const newSize = fs.statSync(output).size;
console.log(`  Original: ${(origSize / 1024 / 1024).toFixed(1)}MB`);
console.log(`  WebP q50: ${(newSize / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Saved: ${((1 - newSize / origSize) * 100).toFixed(0)}%`);

execSync(`rm -rf ${tmpDir}`);
