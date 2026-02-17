/**
 * 지리 서비스 — 위치→타임존, 역지오코딩
 */
import { find as findTz } from 'geo-tz';

export function tzNameToOffset(tzName: string): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tzName, timeZoneName: 'shortOffset' });
  const parts = fmt.formatToParts(now);
  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  const m = tzPart.match(/GMT([+-]?\d+)?/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 0;
}

export function locationToOffset(lat: number, lon: number): number {
  const tzNames = findTz(lat, lon);
  if (tzNames.length === 0) return Math.round(lon / 15);
  return tzNameToOffset(tzNames[0]);
}

export async function reverseGeocode(lat: number, lon: number, lang: string = 'ko'): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=${lang}&zoom=10`;
    const res = await fetch(url, { headers: { 'User-Agent': 'JungBot/1.0' } });
    const data = await res.json() as any;
    return data.address?.city || data.address?.town || data.address?.county || data.address?.state || data.address?.country || 'Unknown';
  } catch {
    return 'Unknown';
  }
}
