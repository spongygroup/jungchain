import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import glob from 'glob';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const dir = 'relay-photos/2026-02-15T13-03-13';

async function main() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  
  const captions: { city: string; caption: string }[] = [];
  for (const f of files) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    captions.push({ city: meta.city, caption: meta.caption });
  }

  const prompt = `Translate each caption to natural Korean (반말, casual). Keep it short and natural. If already Korean, keep as-is.

${captions.map((c, i) => `[${i}] ${c.city}: ${c.caption}`).join('\n')}

Respond in JSON array: [{"idx": 0, "ko": "번역"}, ...]
No markdown.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json\n?/g, '').replace(/```/g, '');
  const translations = JSON.parse(text);
  
  // Save
  fs.writeFileSync(path.join(dir, '_translations.json'), JSON.stringify(translations, null, 2));
  
  for (const t of translations) {
    console.log(`[${t.idx}] ${captions[t.idx].city}: ${t.ko}`);
  }
}

main().catch(console.error);
