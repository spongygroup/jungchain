const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.error("No ETH! Get testnet ETH from faucet first.");
    console.error("Faucet: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet");
    process.exit(1);
  }

  // Deploy JungBlock
  console.log("\nDeploying JungBlock...");
  const JungBlock = await hre.ethers.getContractFactory("JungBlock");
  const jungBlock = await JungBlock.deploy();
  await jungBlock.waitForDeployment();
  const jungBlockAddr = await jungBlock.getAddress();
  console.log("JungBlock deployed:", jungBlockAddr);

  // Deploy JungSoulbound
  console.log("\nDeploying JungSoulbound...");
  const JungSoulbound = await hre.ethers.getContractFactory("JungSoulbound");
  const jungSoulbound = await JungSoulbound.deploy(jungBlockAddr);
  await jungSoulbound.waitForDeployment();
  const jungSoulboundAddr = await jungSoulbound.getAddress();
  console.log("JungSoulbound deployed:", jungSoulboundAddr);

  console.log("\n✅ Deployment complete!");
  console.log("JungBlock:     ", jungBlockAddr);
  console.log("JungSoulbound: ", jungSoulboundAddr);
  console.log("\nBase Sepolia Explorer:");
  console.log(`https://sepolia.basescan.org/address/${jungBlockAddr}`);
  console.log(`https://sepolia.basescan.org/address/${jungSoulboundAddr}`);

  // Save addresses
  const fs = require("fs");
  fs.writeFileSync("contracts/deployed.json", JSON.stringify({
    network: "base-sepolia",
    chainId: 84532,
    jungBlock: jungBlockAddr,
    jungSoulbound: jungSoulboundAddr,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  }, null, 2));
  console.log("\nAddresses saved to contracts/deployed.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
