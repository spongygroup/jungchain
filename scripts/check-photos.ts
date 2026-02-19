import 'dotenv/config';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';

async function main() {
  const db = new Database('./data/jung.db');

  for (const chainId of [19, 20, 21]) {
    const block = db.prepare('SELECT * FROM blocks WHERE chain_id = ? AND slot_index = 1').get(chainId) as any;
    if (!block) { console.log(`Chain #${chainId}: no block`); continue; }

    console.log(`\n═══ Chain #${chainId} ═══`);
    console.log(`  Caption: ${block.content}`);
    console.log(`  File ID: ${block.media_url?.slice(0, 50)}...`);

    // Check file validity via Telegram API
    const res = await fetch(`https://api.telegram.org/bot${config.jungBotToken}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: block.media_url }),
    });
    const data = await res.json() as any;

    if (data.ok) {
      console.log(`  ✅ File valid: ${data.result.file_path} (${data.result.file_size} bytes)`);
    } else {
      console.log(`  ❌ File invalid: ${data.description}`);
    }

    // Try sending to jay to verify display
    try {
      const sendRes = await fetch(`https://api.telegram.org/bot${config.jungBotToken}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: 5023569703,
          photo: block.media_url,
          caption: `[테스트] Chain #${chainId}\n${block.content}`,
        }),
      });
      const sendData = await sendRes.json() as any;
      if (sendData.ok) {
        console.log(`  ✅ Photo sent OK (msg_id: ${sendData.result.message_id})`);
        // Delete test message
        await fetch(`https://api.telegram.org/bot${config.jungBotToken}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: 5023569703, message_id: sendData.result.message_id }),
        });
      } else {
        console.log(`  ❌ Photo send failed: ${sendData.description}`);
      }
    } catch (e: any) {
      console.log(`  ❌ Send error: ${e.message}`);
    }
  }

  db.close();
}

main();
