const fs = require('fs');
let html = fs.readFileSync('data/red-chain-relay-webp.html', 'utf-8');

// First card already done, fix it to use city-row wrapper
html = html.replace(
  '<div class="city">JB · 🇰🇷 Seoul</div><div class="city-time">2:15 AM · UTC+9</div>',
  '<div class="city-row"><div class="city">JB · 🇰🇷 Seoul</div><div class="city-time">2:15 AM (UTC+9)</div></div>'
);

// Data for remaining 23 cards
const cards = [
  { old: 'Olivia · 🇦🇺 Sydney · 2:00 AM · UTC+10', name: 'Olivia', flag: '🇦🇺', city: 'Sydney', tz: 'UTC+10' },
  { old: 'Taro · 🇯🇵 Tokyo · 2:00 AM · UTC+11', name: 'Taro', flag: '🇯🇵', city: 'Tokyo', tz: 'UTC+11' },
  { old: 'Aroha · 🇳🇿 Auckland · 2:00 AM · UTC+12', name: 'Aroha', flag: '🇳🇿', city: 'Auckland', tz: 'UTC+12' },
  { old: 'Tui · 🇼🇸 Samoa · 2:00 AM · UTC-11', name: 'Tui', flag: '🇼🇸', city: 'Samoa', tz: 'UTC-11' },
  { old: 'Leilani · 🇺🇸 Hawaii · 2:00 AM · UTC-10', name: 'Leilani', flag: '🇺🇸', city: 'Hawaii', tz: 'UTC-10' },
  { old: 'Aurora · 🇺🇸 Anchorage · 2:00 AM · UTC-9', name: 'Aurora', flag: '🇺🇸', city: 'Anchorage', tz: 'UTC-9' },
  { old: 'Carlos · 🇺🇸 Los Angeles · 2:00 AM · UTC-8', name: 'Carlos', flag: '🇺🇸', city: 'Los Angeles', tz: 'UTC-8' },
  { old: 'Miguel · 🇲🇽 Mexico City · 2:00 AM · UTC-7', name: 'Miguel', flag: '🇲🇽', city: 'Mexico City', tz: 'UTC-7' },
  { old: 'José · 🇲🇽 Guadalajara · 2:00 AM · UTC-6', name: 'José', flag: '🇲🇽', city: 'Guadalajara', tz: 'UTC-6' },
  { old: 'Sarah · 🇺🇸 New York · 2:00 AM · UTC-5', name: 'Sarah', flag: '🇺🇸', city: 'New York', tz: 'UTC-5' },
  { old: 'Camila · 🇨🇱 Santiago · 2:00 AM · UTC-4', name: 'Camila', flag: '🇨🇱', city: 'Santiago', tz: 'UTC-4' },
  { old: 'Ana · 🇧🇷 São Paulo · 2:00 AM · UTC-3', name: 'Ana', flag: '🇧🇷', city: 'São Paulo', tz: 'UTC-3' },
  { old: 'João · 🇵🇹 Azores · 2:00 AM · UTC-2', name: 'João', flag: '🇵🇹', city: 'Azores', tz: 'UTC-2' },
  { old: 'Maria · 🇵🇹 Lisbon · 2:00 AM · UTC-1', name: 'Maria', flag: '🇵🇹', city: 'Lisbon', tz: 'UTC-1' },
  { old: 'James · 🇬🇧 London · 2:00 AM · UTC+0', name: 'James', flag: '🇬🇧', city: 'London', tz: 'UTC+0' },
  { old: 'Amélie · 🇫🇷 Paris · 2:00 AM · UTC+1', name: 'Amélie', flag: '🇫🇷', city: 'Paris', tz: 'UTC+1' },
  { old: 'Ahmed · 🇪🇬 Cairo · 2:00 AM · UTC+2', name: 'Ahmed', flag: '🇪🇬', city: 'Cairo', tz: 'UTC+2' },
  { old: 'Dmitri · 🇷🇺 Moscow · 2:00 AM · UTC+3', name: 'Dmitri', flag: '🇷🇺', city: 'Moscow', tz: 'UTC+3' },
  { old: 'Layla · 🇦🇪 Dubai · 2:00 AM · UTC+4', name: 'Layla', flag: '🇦🇪', city: 'Dubai', tz: 'UTC+4' },
  { old: 'Imran · 🇵🇰 Karachi · 2:00 AM · UTC+5', name: 'Imran', flag: '🇵🇰', city: 'Karachi', tz: 'UTC+5' },
  { old: 'Rahim · 🇧🇩 Dhaka · 2:00 AM · UTC+6', name: 'Rahim', flag: '🇧🇩', city: 'Dhaka', tz: 'UTC+6' },
  { old: 'Somchai · 🇹🇭 Bangkok · 2:00 AM · UTC+7', name: 'Somchai', flag: '🇹🇭', city: 'Bangkok', tz: 'UTC+7' },
  { old: 'Wei · 🇹🇼 Taipei · 2:00 AM · UTC+8', name: 'Wei', flag: '🇹🇼', city: 'Taipei', tz: 'UTC+8' },
];

for (const c of cards) {
  const min = String(Math.floor(Math.random() * 50 + 1)).padStart(2, '0');
  const newHtml = `<div class="city-row"><div class="city">${c.name} · ${c.flag} ${c.city}</div><div class="city-time">2:${min} AM (${c.tz})</div></div>`;
  html = html.replace(`<div class="city">${c.old}</div>`, newHtml);
}

fs.writeFileSync('data/red-chain-relay-webp.html', html);
console.log('Done! 24 cards updated.');
