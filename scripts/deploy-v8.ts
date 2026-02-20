import 'dotenv/config';
import { ethers } from 'ethers';
import * as fs from 'fs';

const RPC = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const PK = process.env.DEPLOYER_PRIVATE_KEY;
if (!PK) { console.error('Missing DEPLOYER_PRIVATE_KEY'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

async function main() {
  console.log('Deploying JungBlock + JungSoulbound v8 (with transferOperator)...');
  console.log('  Deployer:', wallet.address);

  // Deploy JungBlock
  const blockArtifact = JSON.parse(
    fs.readFileSync('artifacts/contracts/JungBlock.sol/JungBlock.json', 'utf-8')
  );
  const blockFactory = new ethers.ContractFactory(blockArtifact.abi, blockArtifact.bytecode, wallet);
  const blockContract = await blockFactory.deploy();
  await blockContract.waitForDeployment();
  const blockAddr = await blockContract.getAddress();
  console.log('  JungBlock:', blockAddr);

  // Deploy JungSoulbound (needs JungBlock address)
  const soulArtifact = JSON.parse(
    fs.readFileSync('artifacts/contracts/JungSoulbound.sol/JungSoulbound.json', 'utf-8')
  );
  const soulFactory = new ethers.ContractFactory(soulArtifact.abi, soulArtifact.bytecode, wallet);
  const soulContract = await soulFactory.deploy(blockAddr);
  await soulContract.waitForDeployment();
  const soulAddr = await soulContract.getAddress();
  console.log('  JungSoulbound:', soulAddr);

  // Update deployed.json
  const deployed = {
    network: 'base-sepolia',
    chainId: 84532,
    jungBlock: blockAddr,
    jungSoulbound: soulAddr,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync('contracts/deployed.json', JSON.stringify(deployed, null, 2) + '\n');
  console.log('  Updated contracts/deployed.json');
}

main().catch(e => { console.error(e); process.exit(1); });
