import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = '5023569703';
const OUT_DIR = path.join(process.cwd(), 'data', 'relay-photos');

const PHOTO_MSGS = [
  { msgId: 122, label: '01-taipei' },
  { msgId: 123, label: '05-dubai' },
  { msgId: 124, label: '10-azores' },
  { msgId: 125, label: '15-denver' },
  { msgId: 126, label: '20-samoa' },
  { msgId: 127, label: '22-solomon' },
];

async function tg(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function downloadFile(fileId: string, outPath: string) {
  const fileData: any = await tg('getFile', { file_id: fileId });
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error(`No file_path`);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // JB's original tabasco photo — need to find file_id from the message JB sent
  // msg 120 was JB's photo. Let's try getUpdates to find it.
  // Actually, JB's photo would have been consumed during the relay.
  // Skip for now, we can get it from the Telegram chat manually.

  for (const { msgId, label } of PHOTO_MSGS) {
    console.log(`[${label}] msg ${msgId}...`);

    // Bot-sent photos: use getFile on the message.
    // Problem: we don't have file_id, only message_id.
    // Bot API has no way to get message by ID.
    
    // Try: forward to same chat, which creates an incoming update
    const fwdRes: any = await tg('forwardMessage', {
      chat_id: CHAT_ID,
      from_chat_id: CHAT_ID,
      message_id: msgId,
      disable_notification: true,
    });

    if (!fwdRes.ok) {
      console.log(`  SKIP: ${fwdRes.description}`);
      continue;
    }

    const fwdMsg = fwdRes.result;
    if (fwdMsg?.photo) {
      const photo = fwdMsg.photo[fwdMsg.photo.length - 1];
      const outFile = path.join(OUT_DIR, `${label}.jpg`);
      await downloadFile(photo.file_id, outFile);
      const size = fs.statSync(outFile).size;
      console.log(`  ✅ ${(size/1024).toFixed(0)}KB → ${outFile}`);
    } else {
      console.log(`  ⚠️ No photo in forwarded message`);
      console.log(`  keys: ${Object.keys(fwdMsg || {}).join(', ')}`);
    }

    // Delete forwarded message
    await tg('deleteMessage', { chat_id: CHAT_ID, message_id: fwdMsg.message_id });
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone! Photos in ${OUT_DIR}`);
}

main().catch(console.error);
