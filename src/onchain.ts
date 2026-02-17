/**
 * 정체인 온체인 연동 — Base Sepolia
 * 참여 = 블록. Longest chain = most 정.
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ override: true });

// ─── Load deployed addresses ───
const DEPLOYED_PATH = new URL('../contracts/deployed.json', import.meta.url).pathname;
const deployed = JSON.parse(readFileSync(DEPLOYED_PATH, 'utf8'));

// ─── Load ABIs ───
const JUNG_BLOCK_ABI_PATH = new URL('../artifacts/contracts/JungBlock.sol/JungBlock.json', import.meta.url).pathname;
const JUNG_SOULBOUND_ABI_PATH = new URL('../artifacts/contracts/JungSoulbound.sol/JungSoulbound.json', import.meta.url).pathname;
const jungBlockArtifact = JSON.parse(readFileSync(JUNG_BLOCK_ABI_PATH, 'utf8'));
const jungSoulboundArtifact = JSON.parse(readFileSync(JUNG_SOULBOUND_ABI_PATH, 'utf8'));

// ─── Provider + Wallet with NonceManager ───
const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
const rawWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
const wallet = new ethers.NonceManager(rawWallet);

// ─── Contract instances ───
export const jungBlock = new ethers.Contract(deployed.jungBlock, jungBlockArtifact.abi, wallet);
export const jungSoulbound = new ethers.Contract(deployed.jungSoulbound, jungSoulboundArtifact.abi, wallet);

/**
 * Generate a chainId from date+hour string
 * e.g. "2026-02-16-14h" → bytes32
 */
export function makeChainId(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

/**
 * Hash a message (content stays off-chain, hash goes on-chain)
 */
export function hashMessage(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

/**
 * Record a participation on-chain (= add a block)
 * v6: no slotIndex, no isHuman — humans only, timezoneOffset required
 */
export async function recordBlock(
  chainId: string,
  messageContent: string,
  prevBlockHash: string,
  timezoneOffset: number,
  participantAddress?: string,
): Promise<{ blockHash: string; txHash: string }> {
  const messageHash = hashMessage(messageContent);
  const participant = participantAddress || rawWallet.address; // deployer as fallback (never ZeroAddress)

  console.log(`  ⛓️  Recording block UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset} on-chain...`);
  
  // Nonce reset to avoid stale nonce after errors
  wallet.reset();
  await new Promise(r => setTimeout(r, 2000));
  
  const tx = await jungBlock.addBlock(
    chainId,
    messageHash,
    prevBlockHash,
    participant,
    timezoneOffset,
  );
  const receipt = await tx.wait();
  
  // Extract blockHash from BlockAdded event
  const event = receipt.logs
    .map((log: any) => {
      try { return jungBlock.interface.parseLog({ topics: log.topics as string[], data: log.data }); } catch { return null; }
    })
    .find((e: any) => e?.name === 'BlockAdded');

  const blockHash = event?.args?.blockHash || event?.args?.[1] || ethers.ZeroHash;
  
  console.log(`  ⛓️  Block recorded! tx: ${tx.hash.slice(0, 14)}... blockHash: ${blockHash.slice(0, 14)}...`);
  
  return { blockHash, txHash: tx.hash };
}

/**
 * Mint Soulbound NFT for a main chain participant
 */
export async function mintSoulbound(
  to: string,
  chainId: string,
  timezoneOffset: number,
  chainLength: number,
  humanCount: number,
): Promise<{ tokenId: number; txHash: string }> {
  console.log(`  🎖️  Minting Soulbound NFT for ${to.slice(0, 10)}...`);
  
  wallet.reset();
  const tx = await jungSoulbound.mint(to, chainId, timezoneOffset, chainLength, humanCount);
  const receipt = await tx.wait();
  
  const event = receipt.logs
    .map((log: any) => {
      try { return jungSoulbound.interface.parseLog(log); } catch { return null; }
    })
    .find((e: any) => e?.name === 'JungMinted');

  const tokenId = Number(event?.args?.tokenId || 0);
  
  console.log(`  🎖️  Soulbound #${tokenId} minted! tx: ${tx.hash.slice(0, 14)}...`);
  
  return { tokenId, txHash: tx.hash };
}

/**
 * Get chain completion status
 */
export async function isChainCompleted(chainId: string): Promise<boolean> {
  return await jungBlock.chainCompleted(chainId);
}

/**
 * Get explorer URL for a transaction
 */
export function explorerUrl(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

/**
 * Get explorer URL for contract
 */
export function contractUrl(address: string): string {
  return `https://sepolia.basescan.org/address/${address}`;
}
