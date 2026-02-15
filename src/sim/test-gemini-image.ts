import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
config({ override: true });

async function main() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  // imagen 3 for image generation
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp-image-generation' });
  
  console.log('Generating image...');
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: 'Generate a photo-realistic image of a red umbrella on a rainy street in Tokyo.' }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } as any,
  });

  const parts = result.response.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if ((part as any).inlineData) {
      const d = (part as any).inlineData;
      const buf = Buffer.from(d.data, 'base64');
      console.log(`GOT IMAGE: ${d.mimeType}, ${buf.length} bytes`);
      writeFileSync('/tmp/gemini-test-image.png', buf);
      console.log('Saved to /tmp/gemini-test-image.png');
    } else if (part.text) {
      console.log('TEXT:', part.text.slice(0, 200));
    }
  }
}

main().catch(console.error);
