import { config, getCity } from '../config.js';
import { registerUser } from '../modules/user-manager.js';
import type { User } from '../types.js';

export function createVirtualUsers(perTz: number = config.simUsersPerTz): User[] {
  const users: User[] = [];
  let fakeId = 100000;

  for (const offset of config.timezoneOffsets) {
    // Some timezones get fewer users to test AI fallback
    const count = shouldHaveGap(offset) ? 0 : perTz;
    for (let i = 0; i < count; i++) {
      fakeId++;
      const city = getCity(offset);
      const tz = `Virtual/${city.replace(/[\s\/]/g, '_')}`;
      const user = registerUser(fakeId, tz, offset, true);
      users.push(user);
    }
  }

  console.log(`👥 Created ${users.length} virtual users across ${config.timezoneOffsets.length} timezones`);
  return users;
}

// Leave some timezones empty to trigger AI intervention
function shouldHaveGap(offset: number): boolean {
  // UTC+11, UTC-1, UTC-9 have no users → AI fills
  return [11, -1, -9].includes(offset);
}
