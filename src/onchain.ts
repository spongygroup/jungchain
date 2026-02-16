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
 * Returns the blockHash from the transaction event
 */
export async function recordBlock(
  chainId: string,
  slotIndex: number,
  messageContent: string,
  prevBlockHash: string,
  isHuman: boolean,
  participantAddress?: string,
): Promise<{ blockHash: string; txHash: string }> {
  const messageHash = hashMessage(messageContent);
  const participant = participantAddress || ethers.ZeroAddress; // 0x0 for AI

  console.log(`  ⛓️  Recording block slot ${slotIndex} on-chain...`);
  
  // Small delay to ensure previous tx state is reflected on RPC node
  await new Promise(r => setTimeout(r, 2000));
  
  const tx = await jungBlock.addBlock(
    chainId,
    slotIndex,
    messageHash,
    prevBlockHash,
    participant,
    isHuman,
  );
  const receipt = await tx.wait();
  
  // Extract blockHash from BlockAdded event
  const event = receipt.logs
    .map((log: any) => {
      try { return jungBlock.interface.parseLog({ topics: log.topics as string[], data: log.data }); } catch { return null; }
    })
    .find((e: any) => e?.name === 'BlockAdded');

  const blockHash = event?.args?.[2] || event?.args?.blockHash || ethers.ZeroHash; // args[2] = blockHash in event
  
  console.log(`  ⛓️  Block recorded! tx: ${tx.hash.slice(0, 14)}... blockHash: ${blockHash.slice(0, 14)}...`);
  
  return { blockHash, txHash: tx.hash };
}

/**
 * Mint Soulbound NFT for a main chain participant
 */
export async function mintSoulbound(
  to: string,
  chainId: string,
  slotIndex: number,
  chainLength: number,
  humanCount: number,
): Promise<{ tokenId: number; txHash: string }> {
  console.log(`  🎖️  Minting Soulbound NFT for ${to.slice(0, 10)}...`);
  
  const tx = await jungSoulbound.mint(to, chainId, slotIndex, chainLength, humanCount);
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
