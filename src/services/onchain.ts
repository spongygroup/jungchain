/**
 * 정체인 온체인 연동 — Base Sepolia (v7)
 * humanScore/isHuman 제거, timezoneOffset 추가, variant (情/정) 지원
 */
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load deployed addresses (v6) ───
const deployed = JSON.parse(readFileSync(join(__dirname, '../../contracts/deployed.json'), 'utf8'));

// ─── Load ABIs ───
const jungBlockABI = JSON.parse(readFileSync(join(__dirname, '../../artifacts/contracts/JungBlock.sol/JungBlock.json'), 'utf8')).abi;
const jungSoulboundABI = JSON.parse(readFileSync(join(__dirname, '../../artifacts/contracts/JungSoulbound.sol/JungSoulbound.json'), 'utf8')).abi;

// ─── Provider + Wallet ───
const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
const rawWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
const wallet = new ethers.NonceManager(rawWallet);

// ─── Contract instances ───
export const jungBlock = new ethers.Contract(deployed.jungBlock, jungBlockABI, wallet);
export const jungSoulbound = new ethers.Contract(deployed.jungSoulbound, jungSoulboundABI, wallet);

/**
 * Generate a chainId (bytes32) from a label
 */
export function makeChainId(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

/**
 * Hash message content (content stays off-chain, hash on-chain)
 */
export function hashMessage(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

/**
 * Create a chain on-chain
 */
export async function createOnchainChain(
  chainId: string,
  creatorAddress: string,
  startTz: number,
): Promise<string> {
  const tx = await jungBlock.createChain(chainId, creatorAddress, startTz);
  const receipt = await tx.wait();
  console.log(`  ⛓️ Chain created on-chain: ${tx.hash.slice(0, 14)}...`);
  return tx.hash;
}

/**
 * Record a block on-chain (v6: no isHuman, no slotIndex, added timezoneOffset)
 */
export async function recordBlock(
  chainId: string,
  messageContent: string,
  prevBlockHash: string,
  participantAddress?: string,
  timezoneOffset?: number,
): Promise<{ blockHash: string; txHash: string }> {
  const messageHash = hashMessage(messageContent);
  const participant = participantAddress || ethers.ZeroAddress;
  const tz = timezoneOffset ?? 0;

  console.log(`  ⛓️ Recording block on-chain...`);
  await new Promise(r => setTimeout(r, 2000)); // nonce safety

  const tx = await jungBlock.addBlock(chainId, messageHash, prevBlockHash, participant, tz);
  const receipt = await tx.wait();

  // Extract blockHash from BlockAdded event
  const event = receipt.logs
    .map((log: any) => {
      try { return jungBlock.interface.parseLog({ topics: log.topics as string[], data: log.data }); } catch { return null; }
    })
    .find((e: any) => e?.name === 'BlockAdded');

  const blockHash = event?.args?.blockHash || event?.args?.[2] || ethers.ZeroHash;
  console.log(`  ⛓️ Block recorded! tx: ${tx.hash.slice(0, 14)}...`);

  return { blockHash, txHash: tx.hash };
}

/**
 * Mint Soulbound NFT (v7: participantTz, slotNumber, chainLength, variant)
 */
export async function mintSoulbound(
  to: string,
  chainId: string,
  participantTz: number,
  chainLength: number,
  slotNumber: number,
  variant: number = 0,
): Promise<{ tokenId: number; txHash: string }> {
  console.log(`  🎖️ Minting Soulbound NFT for ${to.slice(0, 10)}... (variant=${variant})`);

  const tx = await jungSoulbound.mint(to, chainId, participantTz, chainLength, slotNumber, variant);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: any) => {
      try { return jungSoulbound.interface.parseLog(log); } catch { return null; }
    })
    .find((e: any) => e?.name === 'JungMinted');

  const tokenId = Number(event?.args?.tokenId || 0);
  console.log(`  🎖️ Soulbound #${tokenId} minted! tx: ${tx.hash.slice(0, 14)}...`);

  return { tokenId, txHash: tx.hash };
}

export async function isChainCompleted(chainId: string): Promise<boolean> {
  return await jungBlock.chainCompleted(chainId);
}

export function explorerUrl(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

export function contractUrl(address: string): string {
  return `https://sepolia.basescan.org/address/${address}`;
}
