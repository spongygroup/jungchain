require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org");
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log(`Current nonce: ${nonce}`);

  // JungBlock v4
  const blockArtifact = JSON.parse(fs.readFileSync("artifacts/contracts/JungBlock.sol/JungBlock.json", "utf8"));
  const blockFactory = new ethers.ContractFactory(blockArtifact.abi, blockArtifact.bytecode, wallet);
  console.log("🚀 JungBlock v4 배포 중...");
  const block = await blockFactory.deploy({ nonce: nonce++ });
  await block.waitForDeployment();
  const blockAddr = await block.getAddress();
  console.log(`✅ JungBlock v4: ${blockAddr}`);

  // JungSoulbound
  const sbArtifact = JSON.parse(fs.readFileSync("artifacts/contracts/JungSoulbound.sol/JungSoulbound.json", "utf8"));
  const sbFactory = new ethers.ContractFactory(sbArtifact.abi, sbArtifact.bytecode, wallet);
  console.log("🚀 JungSoulbound 배포 중...");
  const sb = await sbFactory.deploy(blockAddr, { nonce: nonce++ });
  await sb.waitForDeployment();
  const sbAddr = await sb.getAddress();
  console.log(`✅ JungSoulbound: ${sbAddr}`);

  const deployed = {
    network: "base-sepolia",
    chainId: 84532,
    jungBlock: blockAddr,
    jungSoulbound: sbAddr,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    version: "v4-maxNext-fork"
  };
  fs.writeFileSync("contracts/deployed.json", JSON.stringify(deployed, null, 2));
  console.log("📝 deployed.json 업데이트 완료");
  console.log(JSON.stringify(deployed, null, 2));
}

main().catch(console.error);
