const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  
  console.log("Deployer:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Read compiled artifacts
  const jungBlockArtifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/JungBlock.sol/JungBlock.json", "utf8")
  );
  const jungSoulboundArtifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/JungSoulbound.sol/JungSoulbound.json", "utf8")
  );

  // Deploy JungBlock
  console.log("\nDeploying JungBlock...");
  const JungBlockFactory = new ethers.ContractFactory(
    jungBlockArtifact.abi, jungBlockArtifact.bytecode, wallet
  );
  const jungBlock = await JungBlockFactory.deploy();
  await jungBlock.waitForDeployment();
  const jungBlockAddr = await jungBlock.getAddress();
  console.log("JungBlock deployed:", jungBlockAddr);

  // Deploy JungSoulbound
  console.log("\nDeploying JungSoulbound...");
  const JungSoulboundFactory = new ethers.ContractFactory(
    jungSoulboundArtifact.abi, jungSoulboundArtifact.bytecode, wallet
  );
  const jungSoulbound = await JungSoulboundFactory.deploy(jungBlockAddr);
  await jungSoulbound.waitForDeployment();
  const jungSoulboundAddr = await jungSoulbound.getAddress();
  console.log("JungSoulbound deployed:", jungSoulboundAddr);

  // Check remaining balance
  const remaining = await provider.getBalance(wallet.address);
  console.log("\nRemaining balance:", ethers.formatEther(remaining), "ETH");
  console.log("Gas used:", ethers.formatEther(balance - remaining), "ETH");

  console.log("\n✅ Deployment complete!");
  console.log("JungBlock:     ", jungBlockAddr);
  console.log("JungSoulbound: ", jungSoulboundAddr);
  console.log("\nBase Sepolia Explorer:");
  console.log(`https://sepolia.basescan.org/address/${jungBlockAddr}`);
  console.log(`https://sepolia.basescan.org/address/${jungSoulboundAddr}`);

  // Save addresses
  fs.writeFileSync("contracts/deployed.json", JSON.stringify({
    network: "base-sepolia",
    chainId: 84532,
    jungBlock: jungBlockAddr,
    jungSoulbound: jungSoulboundAddr,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
  }, null, 2));
  console.log("\nAddresses saved to contracts/deployed.json");
}

main().catch(console.error);
