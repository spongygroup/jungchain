import 'dotenv/config';

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  simMode: process.env.SIM_MODE === 'true',
  simSpeed: Number(process.env.SIM_SPEED ?? '60'),
  simUsersPerTz: Number(process.env.SIM_USERS_PER_TZ ?? '2'),
  dbPath: process.env.DB_PATH ?? './data/jung.db',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxMessageLength: 300,
  chainSize: 24,
  // UTC offsets from +12 down to -11
  timezoneOffsets: Array.from({ length: 24 }, (_, i) => 12 - i),
} as const;

// Timezone offset → representative city name
export const TZ_CITIES: Record<number, string> = {
  12: 'Auckland',
  11: 'Solomon Islands',
  10: 'Sydney',
  9: 'Seoul/Tokyo',
  8: 'Shanghai/Taipei',
  7: 'Bangkok',
  6: 'Dhaka',
  5: 'Karachi',
  4: 'Dubai',
  3: 'Moscow',
  2: 'Cairo',
  1: 'Paris',
  0: 'London',
  '-1': 'Azores',
  '-2': 'Mid-Atlantic',
  '-3': 'São Paulo',
  '-4': 'New York',
  '-5': 'Chicago',
  '-6': 'Denver',
  '-7': 'Los Angeles',
  '-8': 'Anchorage',
  '-9': 'Alaska',
  '-10': 'Hawaii',
  '-11': 'Samoa',
};

// Timezone offset → local language for message generation
export const TZ_LANGUAGES: Record<number, string> = {
  12: 'te reo Māori (or English with NZ flavor)',
  11: 'Solomon Islands Pijin (or English)',
  10: 'Australian English',
  9: '한국어',
  8: '中文 (繁體)',
  7: 'ภาษาไทย',
  6: 'বাংলা',
  5: 'اردو',
  4: 'العربية',
  3: 'Русский',
  2: 'العربية المصرية',
  1: 'Français',
  0: 'British English',
  '-1': 'Português',
  '-2': 'English',
  '-3': 'Português brasileiro',
  '-4': 'American English',
  '-5': 'American English',
  '-6': 'American English / Español',
  '-7': 'American English / Español',
  '-8': 'English',
  '-9': 'English',
  '-10': 'Hawaiian Pidgin (or English)',
  '-11': 'Samoan (Gagana Sāmoa) or English',
};

export function getCity(offset: number): string {
  return TZ_CITIES[offset] ?? `UTC${offset >= 0 ? '+' : ''}${offset}`;
}
