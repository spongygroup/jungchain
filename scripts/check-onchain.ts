import 'dotenv/config';
import { jungBlock, makeChainId } from '../src/services/onchain.js';

const label = process.argv[2] || 'v7-test-1771507703011';
const chainId = makeChainId(label);

const count = await jungBlock.chainBlockCount(chainId);
const completed = await jungBlock.chainCompleted(chainId);
const active = await jungBlock.chainActive(chainId);

console.log(`Chain: ${label}`);
console.log(`chainBlockCount: ${Number(count)}`);
console.log(`chainCompleted:  ${completed}`);
console.log(`chainActive:     ${active}`);
