import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const deployed = JSON.parse(readFileSync(join(__dirname, '../contracts/deployed.json'), 'utf8'));
const jungBlockABI = JSON.parse(readFileSync(join(__dirname, '../artifacts/contracts/JungBlock.sol/JungBlock.json'), 'utf8')).abi;

const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
const contract = new ethers.Contract(deployed.jungBlock, jungBlockABI, provider);

// Same as makeChainId in onchain.ts
const onchainId = ethers.keccak256(ethers.toUtf8Bytes('jung-323'));

async function main() {
  try {
    const blockCount = await contract.chainBlockCount(onchainId);
    const creator = await contract.chainCreator(onchainId);
    const startTz = await contract.chainStartTz(onchainId);
    const active = await contract.chainActive(onchainId);
    const completed = await contract.chainCompleted(onchainId);
    console.log('Chain jung-323 on-chain:');
    console.log('  blockCount:', blockCount.toString());
    console.log('  creator:', creator);
    console.log('  startTz:', startTz.toString());
    console.log('  active:', active);
    console.log('  completed:', completed);
  } catch(e: any) { console.error('Error:', e.message?.slice(0, 200)); }
}
main();
