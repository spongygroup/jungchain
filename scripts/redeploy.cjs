const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

  const artifact = JSON.parse(fs.readFileSync("artifacts/contracts/JungBlock.sol/JungBlock.json", "utf8"));
  console.log("\nDeploying JungBlock v2...");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("JungBlock v2:", addr);

  // Update deployed.json
  const deployed = JSON.parse(fs.readFileSync("contracts/deployed.json", "utf8"));
  deployed.jungBlock = addr;
  deployed.deployedAt = new Date().toISOString();
  fs.writeFileSync("contracts/deployed.json", JSON.stringify(deployed, null, 2));
  console.log("Updated deployed.json");
  console.log(`https://sepolia.basescan.org/address/${addr}`);
}
main().catch(console.error);
