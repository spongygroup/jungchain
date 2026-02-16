require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  
  const artifact = JSON.parse(fs.readFileSync("artifacts/contracts/JungBlock.sol/JungBlock.json", "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log("🚀 JungBlock v2 배포 중... (permissionless)");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  
  const addr = await contract.getAddress();
  console.log(`✅ JungBlock v2: ${addr}`);
  console.log(`🔗 https://sepolia.basescan.org/address/${addr}`);
  
  // deployed.json 업데이트
  const deployed = JSON.parse(fs.readFileSync("contracts/deployed.json", "utf8"));
  deployed.jungBlockV1 = deployed.jungBlock;
  deployed.jungBlock = addr;
  fs.writeFileSync("contracts/deployed.json", JSON.stringify(deployed, null, 2));
  console.log("📝 deployed.json 업데이트 완료");
}

main().catch(console.error);
