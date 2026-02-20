import 'dotenv/config';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

const RPC = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const PK = process.env.DEPLOYER_PRIVATE_KEY;
if (!PK) { console.error('Missing DEPLOYER_PRIVATE_KEY'); process.exit(1); }

const deployed = JSON.parse(fs.readFileSync('contracts/deployed.json', 'utf-8'));
const jungBlockAddr = deployed.jungBlock;

const artifact = JSON.parse(
  fs.readFileSync('artifacts/contracts/JungSoulbound.sol/JungSoulbound.json', 'utf-8')
);

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

async function main() {
  console.log('Deploying JungSoulbound v7...');
  console.log('  Deployer:', wallet.address);
  console.log('  JungBlock:', jungBlockAddr);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(jungBlockAddr);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('  Deployed at:', addr);

  // Update deployed.json
  deployed.jungSoulbound = addr;
  deployed.deployedAt = new Date().toISOString();
  fs.writeFileSync('contracts/deployed.json', JSON.stringify(deployed, null, 2) + '\n');
  console.log('  Updated contracts/deployed.json');
}

main().catch(e => { console.error(e); process.exit(1); });
