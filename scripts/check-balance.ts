import 'dotenv/config';
import { ethers } from 'ethers';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
  const addr = process.env.DEPLOYER_ADDRESS || '0x8D555CFc4B3F5FE21a3755043E80bbF4e85af1c1';
  const balance = await provider.getBalance(addr);
  console.log('Deployer:', addr);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');
  console.log('Enough for gas:', Number(ethers.formatEther(balance)) > 0.001 ? '✅' : '❌ Need to fund');
}
main();
