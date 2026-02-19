import { config } from 'dotenv';
config({ override: true });

const pk = process.env.DEPLOYER_PRIVATE_KEY;
console.log('Key length:', pk?.length);
console.log('Starts with 0x:', pk?.startsWith('0x'));
console.log('First 10:', pk?.slice(0, 10));
console.log('Last 5:', pk?.slice(-5));
console.log('Has whitespace:', /\s/.test(pk || ''));
