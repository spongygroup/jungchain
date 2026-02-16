require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const deployed = JSON.parse(fs.readFileSync("contracts/deployed.json", "utf8"));

  // Soulbound 재배포 (새 JungBlock 주소 연결)
  const sbArtifact = JSON.parse(fs.readFileSync("artifacts/contracts/JungSoulbound.sol/JungSoulbound.json", "utf8"));
  const sbFactory = new ethers.ContractFactory(sbArtifact.abi, sbArtifact.bytecode, wallet);
  
  console.log("🚀 JungSoulbound 재배포 중...");
  const sb = await sbFactory.deploy(deployed.jungBlock);
  await sb.waitForDeployment();
  const sbAddr = await sb.getAddress();
  console.log(`✅ JungSoulbound: ${sbAddr}`);

  deployed.jungSoulbound = sbAddr;
  deployed.deployedAt = new Date().toISOString();
  fs.writeFileSync("contracts/deployed.json", JSON.stringify(deployed, null, 2));
  console.log("📝 deployed.json 업데이트 완료");
  console.log(JSON.stringify(deployed, null, 2));
}

main().catch(console.error);
