import { CdpClient } from "@coinbase/cdp-sdk";
import { readFileSync } from "fs";
import { ethers } from "ethers";

const creds = JSON.parse(readFileSync(process.env.HOME + "/.config/cdp/credentials.json", "utf8"));
const deployed = JSON.parse(readFileSync("contracts/deployed.json", "utf8"));
const abi = JSON.parse(readFileSync("artifacts/contracts/JungBlock.sol/JungBlock.json", "utf8")).abi;
const iface = new ethers.Interface(abi);

async function main() {
  const cdp = new CdpClient({
    apiKeyId: creds.apiKeyId,
    apiKeySecret: creds.apiKeySecret,
    walletSecret: creds.walletSecret,
  });

  const account = await cdp.evm.createAccount();
  console.log(`✅ 지갑: ${account.address}`);
  
  console.log("💧 Faucet...");
  await cdp.evm.requestFaucet({ address: account.address, network: "base-sepolia", token: "eth" });
  await new Promise(r => setTimeout(r, 5000));

  const chainId = ethers.keccak256(ethers.toUtf8Bytes("cdp-test-2"));
  const msgHash = ethers.keccak256(ethers.toUtf8Bytes("유저가 직접 쓴 블록!"));
  
  // participant = address(0) → 컨트랙트가 msg.sender로 대체
  const calldata = iface.encodeFunctionData("addBlock", [
    chainId, 0, msgHash, ethers.ZeroHash, ethers.ZeroAddress, true
  ]);

  console.log("⛓️  addBlock 호출 중 (유저 지갑에서 직접)...");
  const txHash = await cdp.evm.sendTransaction({
    address: account.address,
    transaction: { to: deployed.jungBlock, data: calldata },
    network: "base-sepolia",
  });

  console.log(`✅ 성공! tx: ${txHash}`);
  console.log(`🔗 https://sepolia.basescan.org/tx/${txHash}`);
}

main().catch(console.error);
