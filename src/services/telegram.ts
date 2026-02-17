/**
 * 텔레그램 유틸 — grammy Bot 인스턴스를 통한 전송
 */
import type { Bot } from 'grammy';

// ─── Retry wrapper ───
async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 3000): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      console.error(`  ⚠️ Attempt ${i + 1}/${attempts} failed: ${err.message}`);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

// ─── Send text with retry ───
export async function sendText(
  bot: Bot,
  chatId: number,
  text: string,
  options?: any,
): Promise<number | null> {
  // Telegram 4096 char limit
  const chunks: string[] = [];
  if (text.length > 4000) {
    for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  } else {
    chunks.push(text);
  }

  let lastMsgId: number | null = null;
  for (const chunk of chunks) {
    const result = await retry(async () => {
      const sent = await bot.api.sendMessage(chatId, chunk, options);
      return sent.message_id;
    });
    if (result) lastMsgId = result;
  }
  return lastMsgId;
}

// ─── Send photo with retry ───
export async function sendPhoto(
  bot: Bot,
  chatId: number,
  photo: string, // URL or file_id
  caption?: string,
): Promise<number | null> {
  return retry(async () => {
    const sent = await bot.api.sendPhoto(chatId, photo, caption ? { caption } : undefined);
    return sent.message_id;
  });
}

// ─── Delete message (silent fail) ───
export async function deleteMessage(bot: Bot, chatId: number, messageId: number): Promise<void> {
  try {
    await bot.api.deleteMessage(chatId, messageId);
  } catch { /* already deleted */ }
}

// ─── Download photo from Telegram → base64 ───
export async function getPhotoBase64(bot: Bot, fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path;
  if (!filePath) throw new Error('Could not get file path');

  const token = bot.token;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.toString('base64');
}

// ─── Get largest photo from message ───
export function getLargestPhotoId(photos: any[]): string | null {
  if (!photos || photos.length === 0) return null;
  return photos[photos.length - 1].file_id;
}
