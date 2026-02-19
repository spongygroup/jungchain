# 정 (Jung) — Timezone Relay Chain

> 시간이 만드는 연결. 기다림이 만드는 정.

**정(情)**은 시간대를 따라 메시지가 릴레이되는 Telegram 봇입니다.
"나의 2시"에 보낸 마음이, 상대방의 "2시"에 도착합니다.

## 컨셉

한국어에만 있는 감정 **정(情)** — 시간이 쌓여야 생기는 깊은 유대감.
이 앱은 그 정을 디지털로 구현합니다.

- **시간 기반 릴레이**: 24개 타임존을 따라 메시지가 전달
- **스토리 릴레이**: 각 블록에서 이야기를 쓰고, 2개 선택지 제시 → 다음 유저가 이어감
- **포토 릴레이**: 사진 미션 → AI가 사진 검증
- **포크 체인**: 같은 타임존 슬롯에 여러 참여자 → Copy-on-Fork로 체인 분기
- **AI 정지기**: 빈 타임존을 AI가 채워 릴레이가 끊기지 않도록 보조
- **온체인 기록**: Base Sepolia에 블록 해시 영구 기록

## 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | TypeScript + Node.js (tsx) |
| 봇 | Telegram (grammY) |
| DB | SQLite (better-sqlite3) |
| AI (스토리) | Google Gemini 2.5 Pro |
| AI (번역/검증/STT) | Google Gemini 2.0 Flash |
| 온체인 | Base Sepolia (Coinbase CDP SDK) |
| 스마트 컨트랙트 | Solidity (Hardhat) |
| 타임존 | geo-tz + Luxon |
| 지오코딩 | Nominatim (OpenStreetMap) |

## 프로젝트 구조

```
src/
├── jung-bot.ts           # 엔트리포인트 (Telegram 봇)
├── config.ts             # 설정 (타임존, 언어 매핑)
├── db/
│   ├── database.ts       # DB 연결 + 쿼리 (체인, 블록, 포크)
│   └── schema.sql        # 테이블 스키마
└── services/
    ├── ai.ts             # AI 서비스 (Gemini 스토리/번역/검증/STT)
    ├── geo.ts            # 지오코딩 (Nominatim)
    ├── i18n.ts           # 다국어 지원 (17개 언어)
    ├── onchain.ts        # 온체인 기록 (Base Sepolia)
    ├── telegram.ts       # Telegram 메시지 유틸
    └── wallet.ts         # CDP 지갑 생성/관리

contracts/
├── JungBlock.sol         # 블록 해시 기록 컨트랙트
├── JungSoulbound.sol     # 소울바운드 NFT 컨트랙트
└── deployed.json         # 배포 주소 (Base Sepolia)

scripts/                  # 유틸리티 스크립트 (시뮬레이션, 테스트 등)
```

## 실행 방법

### 환경 설정

```bash
cp .env.example .env
```

`.env` 파일에 필요한 키:

```
GOOGLE_API_KEY=           # Gemini 2.5 Pro + 2.0 Flash
JUNG_BOT_TOKEN=           # Telegram 봇 토큰
ENABLE_ONCHAIN=true       # 온체인 기록 활성화 (선택)
```

### 명령어

```bash
# 의존성 설치
npm install

# 개발 모드 (hot reload)
npm run dev

# 프로덕션 빌드
npm run build && npm run start

# 테스트
npm test
```

## 온체인

- **네트워크**: Base Sepolia (chainId: 84532)
- **JungBlock**: [`0x4E2ff5f12EDa184992c66A2b9c015Bf4aB60D208`](https://sepolia.basescan.org/address/0x4E2ff5f12EDa184992c66A2b9c015Bf4aB60D208)
- **JungSoulbound**: [`0x33D52808224E570d6e98f3CBaD8bC59a43A67fc1`](https://sepolia.basescan.org/address/0x33D52808224E570d6e98f3CBaD8bC59a43A67fc1)

## 포크 시스템

같은 타임존 슬롯에 이미 블록이 있으면 **Copy-on-Fork**로 체인이 분기됩니다:

1. 기존 체인의 블록들을 복사하여 새 포크 체인 생성
2. 새 참여자의 블록이 포크 체인에 추가
3. 각 포크 체인은 독립적으로 24시간 후 완료
4. 온체인에 별도 체인 ID (`jung-{forkChainId}`)로 기록

## 다국어 지원

17개 언어: 한국어, English, 日本語, 中文, ไทย, Español, Português, Français, العربية, Русский, Deutsch, Italiano, Türkçe, हिन्दी, Bahasa Indonesia, Tiếng Việt, Українська

도시명은 등록 시 17개 언어로 사전 번역되어 캐시됩니다.

## 현재 상태

- ✅ Telegram 봇 라이브 (@beanie_jungbot)
- ✅ 스토리 릴레이 (Gemini 2.5 Pro, 17개 언어)
- ✅ 포토 릴레이 + AI 사진 검증
- ✅ 포크 시스템 (시뮬레이션 검증: 100유저 × 24TZ → 269포크, 3,576블록)
- ✅ 온체인 기록 (Base Sepolia, 24블록 선형 테스트 통과)
- ✅ 소울바운드 NFT 컨트랙트 배포
- ✅ 다국어 지원 (17개 언어, 도시명 사전 번역)

## 문서

- [`docs/jung-overview.md`](./docs/jung-overview.md) — 프로젝트 개요
- [`docs/vibelabs-submission.md`](./docs/vibelabs-submission.md) — Vibelabs 제출

## 라이선스

MIT — © 2026 spongy group
