#!/usr/bin/env npx tsx
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployed = JSON.parse(readFileSync('contracts/deployed.json', 'utf8'));
const artifact = JSON.parse(readFileSync('artifacts/contracts/JungBlock.sol/JungBlock.json', 'utf8'));
const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
const contract = new ethers.Contract(deployed.jungBlock, artifact.abi, wallet);

async function main() {
  const chainLabel = `debug-${Date.now()}`;
  const chainId = ethers.keccak256(ethers.toUtf8Bytes(chainLabel));
  
  console.log('chainId:', chainId);
  
  // Block 0
  const nonce0 = await wallet.getNonce();
  const tx0 = await contract.addBlock(
    chainId, 0, 
    ethers.keccak256(ethers.toUtf8Bytes('hello')),
    ethers.ZeroHash,
    ethers.ZeroAddress,
    true,
    { nonce: nonce0 }
  );
  const r0 = await tx0.wait();
  
  console.log('\n--- Block 0 receipt logs ---');
  for (const log of r0.logs) {
    console.log('topics:', log.topics);
    console.log('data:', log.data);
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      console.log('parsed:', parsed?.name, parsed?.args);
    } catch(e) { console.log('parse failed'); }
  }

  // Get blockHash from event
  const parsed0 = contract.interface.parseLog({ topics: r0.logs[0].topics as string[], data: r0.logs[0].data });
  const blockHash0 = parsed0?.args?.[2]; // blockHash is 3rd arg (indexed: chainId, slotIndex, then blockHash in data?)
  console.log('\nblockHash0:', blockHash0);

  // Verify on-chain
  const stored = await contract.blocks(blockHash0);
  console.log('\nstored block:', stored);
  console.log('stored chainId:', stored[0]);
  console.log('matches?', stored[0] === chainId);
}

main().catch(console.error);
