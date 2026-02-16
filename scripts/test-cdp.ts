import { CdpClient } from "@coinbase/cdp-sdk";
import { readFileSync } from "fs";

const creds = JSON.parse(readFileSync(process.env.HOME + "/.config/cdp/credentials.json", "utf8"));

async function main() {
  const cdp = new CdpClient({
    apiKeyId: creds.apiKeyId,
    apiKeySecret: creds.apiKeySecret,
    walletSecret: creds.walletSecret,
  });

  console.log("🔑 CDP 연결 성공, 지갑 생성 중...");
  const account = await cdp.evm.createAccount();
  console.log(`✅ 지갑 생성 완료!`);
  console.log(`   주소: ${account.address}`);
}

main().catch(console.error);
