/**
 * AI 서비스 — Gemini 기반 스토리/캡션/번역/검증 + OpenAI Whisper STT
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI, { toFile } from 'openai';
import { config, getCity, TZ_LANGUAGES } from '../config.js';

const genAI = new GoogleGenerativeAI(config.googleApiKey);

function getModel(modelName?: string) {
  return genAI.getGenerativeModel({ model: modelName ?? 'gemini-2.5-pro' });
}

// ─── Story relay: generate next chapter with choices ───
const CHOICE_FORMAT = `
형식:
1. 이전 선택지가 있으면 하나를 골라서 시작
2. 스토리를 150~300자로 전개 (배경 묘사 최소화, 액션/대화/감정 위주)
3. 마지막에 선택지 2개 제시

출력 형식:
[선택: A 또는 B] (이전 선택지가 있을 때만)

(스토리 본문 150~300자)

A) (선택지 1)
B) (선택지 2)`;

export async function generateStoryBlock(
  previousBlocks: string[],
  offset: number,
  isFirst: boolean = false,
  isLast: boolean = false,
): Promise<string> {
  const model = getModel();
  const city = getCity(offset);
  const lang = TZ_LANGUAGES[offset] ?? 'English';
  const context = previousBlocks.slice(-5).join('\n');

  let systemPrompt: string;
  let userPrompt: string;

  if (isFirst) {
    systemPrompt = `You are a novelist from ${city}. Write the opening scene of a relay novel.
- Write in ${lang}
- Romance/thriller genre. Hook the reader immediately.
- 150-300 characters. Minimal scenery, focus on action/dialogue.
- End with 2 choices (A/B)`;
    userPrompt = `Start the relay novel from ${city}. Strong opening + 2 choices.`;
  } else if (isLast) {
    systemPrompt = `너는 ${city}의 작가야. 릴레이 소설의 마지막 장면을 써.
- ${lang}(으)로
- 이전 선택지 중 하나를 골라 시작
- 감동적인 결말. 여운이 남게.
- 150~300자. 선택지 없이 마무리.`;
    userPrompt = `릴레이 소설:\n${context}\n\n결말을 써줘. 선택지 없이 마무리.`;
  } else {
    systemPrompt = `너는 릴레이 소설에 참여하는 ${city}의 작가야.
- 반드시 ${lang}(으)로 써
- 이전 스토리를 읽고 자연스럽게 이어가
- 너의 도시/문화적 요소를 녹여
- 배경 묘사 최소화. 대화, 액션, 감정, 반전 위주.
${CHOICE_FORMAT}`;
    userPrompt = `릴레이 소설 진행 중:\n${context}\n\n${lang}(으)로 이어써줘.`;
  }

  try {
    const result = await model.generateContent({
      systemInstruction: systemPrompt,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
    return result.response.text()?.trim() || '...';
  } catch (err: any) {
    console.error(`AI story generation error: ${err.message}`);
    return '(이야기가 조용히 이어집니다...)';
  }
}

// ─── Translate relay content (with in-memory cache) ───
const translateCache = new Map<string, string>();

export async function translateContent(
  content: string[],
  targetLang: string,
): Promise<string> {
  if (content.length === 0) return '';
  const text = content.join('\n');
  const cacheKey = `${targetLang}::${text}`;
  const cached = translateCache.get(cacheKey);
  if (cached) return cached;

  const model = getModel('gemini-2.0-flash');

  try {
    const result = await model.generateContent({
      systemInstruction: `너는 번역가야. 릴레이 콘텐츠를 ${targetLang}(으)로 번역해줘.
- 원문의 느낌과 뉘앙스를 살려서
- 각 블록 구분 유지
- 번역만 출력. 설명 없이.`,
      contents: [{ role: 'user', parts: [{ text: `다음을 ${targetLang}(으)로 번역해줘:\n\n${text}` }] }],
    });
    const translated = result.response.text().trim();
    translateCache.set(cacheKey, translated);
    return translated;
  } catch (err: any) {
    console.error(`Translation error: ${err.message}`);
    return `(번역 실패)\n${text}`;
  }
}

// ─── Photo validation (mission + safety) ───
export async function validatePhoto(
  photoBase64: string,
  mission: string,
): Promise<{ status: 'pass' | 'mission_fail' | 'safety_fail'; description: string; userMessage: string; jungzigiComment: string }> {
  const model = getModel('gemini-2.0-flash');

  try {
    const result = await model.generateContent({
      systemInstruction: `You are a photo validator for a fun photo relay game. Check TWO things:

1. SAFETY CHECK (strict):
   - Personal info visible? (ID cards, credit cards, documents, license plates)
   - Faces clearly identifiable? (close-up portraits — crowd/distant faces OK)
   - NSFW content?
   If ANY safety issue: status="safety_fail"

2. MISSION CHECK (lenient):
   - Does the photo reasonably match the mission?
   - Be generous — creative interpretations welcome!
   If doesn't match: status="mission_fail"

3. If both pass: status="pass"

Respond ONLY in JSON:
{
  "status": "pass" | "mission_fail" | "safety_fail",
  "description": "brief description in English",
  "userMessage": "friendly message to user in their language (1-2 sentences, casual, warm)",
  "jungzigiComment": "a warm, personal 1-sentence comment about the photo in the user's language — like a friend reacting to the photo (e.g. '와 이 빛 진짜 예쁘다!', 'That sky is amazing! 🌅'). Be genuine, specific to what you see."
}`,
      contents: [{
        role: 'user',
        parts: [
          { text: `Mission: "${mission}"\nValidate this photo:` },
          { inlineData: { mimeType: 'image/jpeg', data: photoBase64 } },
        ],
      }],
    });

    const raw = result.response.text().trim();
    const json = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, ''));
    return json;
  } catch (err: any) {
    console.error(`Photo validation error: ${err.message}`);
    return { status: 'pass', description: 'validation skipped', userMessage: '확인 완료!', jungzigiComment: '좋은 사진이네요! 📸' };
  }
}

// ─── Generate photo via Imagen 4 ───
export async function generatePhoto(
  prompt: string,
  aspectRatio: string = '9:16',
): Promise<string | null> {
  const apiKey = config.googleApiKey;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    });
    const data = await res.json() as any;
    return data.predictions?.[0]?.bytesBase64Encoded ?? null;
  } catch (err: any) {
    console.error(`Imagen 4 error: ${err.message}`);
    return null;
  }
}

// ─── Generate photo caption/description ───
export async function generatePhotoCaption(
  offset: number,
  mission: string,
  previousCaption: string | null,
  style: string,
): Promise<string> {
  const model = getModel('gemini-2.0-flash');
  const city = getCity(offset);
  const lang = TZ_LANGUAGES[offset] ?? 'English';

  try {
    const result = await model.generateContent({
      systemInstruction: `너는 ${city}에 사는 사람이야. 포토 릴레이에 참여 중.
- ${lang}(으)로 써
- 스타일: ${style}
- 사진 미션: ${mission}
- 캐주얼하고 짧게 (1-2문장)
- 해시태그 없이`,
      contents: [{
        role: 'user',
        parts: [{ text: previousCaption ? `이전 캡션: "${previousCaption}"\n\n${city}에서 찍은 사진 캡션을 써줘.` : `${city}에서 찍은 사진 캡션을 써줘.` }],
      }],
    });
    return result.response.text().trim();
  } catch {
    return `📍 ${city}`;
  }
}

// ─── Content validation (Gemini Flash) ───
export async function validateText(text: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    const model = getModel('gemini-2.0-flash');
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text:
        `다음 텍스트가 안전한지 판단해줘. 차단 기준: 혐오/차별, 성적 콘텐츠, 폭력 선동, 개인정보 노출. 일상적인 표현이나 가벼운 욕설은 허용.
JSON으로만 답해: {"safe": true} 또는 {"safe": false, "reason": "사유"}

텍스트: "${text}"` }] }],
    });
    const json = result.response.text().trim().replace(/```json\n?|\n?```/g, '');
    return JSON.parse(json);
  } catch {
    return { safe: true }; // fail-open
  }
}

// ─── Voice transcription via OpenAI Whisper ───
export async function transcribeVoice(audioBuffer: Buffer): Promise<string> {
  const model = getModel('gemini-2.0-flash');
  const base64Audio = audioBuffer.toString('base64');

  try {
    const result = await model.generateContent({
      systemInstruction: 'You are a speech-to-text transcriber. Transcribe the audio exactly as spoken. Output ONLY the transcription text, nothing else. If the audio is unclear or empty, output an empty string.',
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcribe this audio:' },
          { inlineData: { mimeType: 'audio/ogg', data: base64Audio } },
        ],
      }],
    });
    return result.response.text().trim();
  } catch (err: any) {
    console.error(`Gemini STT error: ${err.message}`);
    return '';
  }
}
