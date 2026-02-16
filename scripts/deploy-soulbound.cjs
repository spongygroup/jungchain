const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  
  console.log("Deployer:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // JungBlock already deployed
  const jungBlockAddr = "0xB818c8f618DDC9650525A71360F176C683167a7E";
  console.log("JungBlock (existing):", jungBlockAddr);

  const jungSoulboundArtifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/JungSoulbound.sol/JungSoulbound.json", "utf8")
  );

  console.log("\nDeploying JungSoulbound...");
  const factory = new ethers.ContractFactory(
    jungSoulboundArtifact.abi, jungSoulboundArtifact.bytecode, wallet
  );
  const contract = await factory.deploy(jungBlockAddr);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("JungSoulbound deployed:", addr);

  const remaining = await provider.getBalance(wallet.address);
  console.log("Remaining:", ethers.formatEther(remaining), "ETH");

  console.log("\n✅ Deployment complete!");
  console.log("JungBlock:     ", jungBlockAddr);
  console.log("JungSoulbound: ", addr);
  console.log("\nhttps://sepolia.basescan.org/address/" + jungBlockAddr);
  console.log("https://sepolia.basescan.org/address/" + addr);

  fs.writeFileSync("contracts/deployed.json", JSON.stringify({
    network: "base-sepolia",
    chainId: 84532,
    jungBlock: jungBlockAddr,
    jungSoulbound: addr,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
  }, null, 2));
}

main().catch(console.error);
