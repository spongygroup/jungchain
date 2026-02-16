import { CdpClient } from "@coinbase/cdp-sdk";
import { readFileSync } from "fs";

const creds = JSON.parse(readFileSync(process.env.HOME + "/.config/cdp/credentials.json", "utf8"));

async function main() {
  const cdp = new CdpClient({
    apiKeyId: creds.apiKeyId,
    apiKeySecret: creds.apiKeySecret,
    walletSecret: creds.walletSecret,
  });

  // 1. 계정 생성
  const account = await cdp.evm.createAccount();
  console.log(`✅ 지갑: ${account.address}`);

  // 2. 테스트넷 ETH 받기 (faucet)
  console.log("💧 Faucet 요청 중...");
  try {
    const faucetHash = await cdp.evm.requestFaucet({
      address: account.address,
      network: "base-sepolia",
      token: "eth",
    });
    console.log(`💧 Faucet tx: ${faucetHash}`);
  } catch (e: any) {
    console.log(`💧 Faucet 실패: ${e.message}`);
  }

  // 3. 스마트 컨트랙트 호출 테스트 (JungBlock recordBlock)
  console.log("\n⛓️  컨트랙트 호출은 deployer 지갑으로 해야 해서,");
  console.log("   CDP 지갑은 Soulbound NFT 수신용으로 사용.");
  console.log(`   민팅 대상 주소: ${account.address}`);
}

main().catch(console.error);
