# 정 (Jung) — Timezone Relay Chain

> 시간이 만드는 연결. 기다림이 만드는 정.

**정(情)**은 시간대를 따라 메시지가 릴레이되는 P2P 연결 앱입니다.
"나의 2시"에 보낸 마음이, 상대방의 "2시"에 도착합니다.

## 컨셉

한국어에만 있는 감정 **정(情)** — 시간이 쌓여야 생기는 깊은 유대감.
이 앱은 그 정을 디지털로 구현합니다.

- 🕐 **시간 기반 릴레이**: 24개 타임존을 따라 메시지가 전달
- 🎮 **선택형 릴레이**: 각 블록에서 이야기를 쓰고, 2개 선택지 제시 → 다음 유저가 이어감
- 📸 **포토 릴레이**: 사진 미션 → AI가 다음 도시의 이미지 생성
- 🤖 **AI 정지기**: 빈 타임존을 AI가 채워 릴레이가 끊기지 않도록 보조

## 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | TypeScript + Node.js (tsx) |
| AI (텍스트) | Google Gemini 2.5 Pro |
| AI (이미지) | Google Imagen 4 |
| 사진 검증 | Gemini Vision (미션 + 안전 필터) |
| 봇 | Telegram (grammY) |
| DB | SQLite (better-sqlite3) |
| 타임존 | geo-tz + Luxon |
| 지오코딩 | Nominatim (OpenStreetMap) |

## 프로젝트 구조

```
src/
├── index.ts              # 앱 엔트리포인트
├── bot.ts                # Telegram 봇 핸들러
├── clock.ts              # 24시간 시계 로직
├── config.ts             # 설정 (타임존, 언어 매핑)
├── types.ts              # 타입 정의
├── db/
│   ├── database.ts       # DB 연결 + 쿼리
│   ├── init.ts           # DB 초기화
│   └── schema.sql        # 테이블 스키마
├── modules/
│   ├── ai-jungzigi.ts    # AI 정지기 (Gemini)
│   ├── chain-manager.ts  # 릴레이 체인 관리
│   ├── message-store.ts  # 메시지 저장소
│   ├── scheduler.ts      # 스케줄러
│   └── user-manager.ts   # 유저 관리
└── sim/
    ├── live-relay.ts     # 라이브 텍스트 릴레이
    ├── live-relay-photo.ts # 라이브 포토 릴레이
    ├── sim-runner.ts     # 시뮬레이션 러너
    ├── test-one-block.ts # 단일 블록 테스트
    ├── test-gemini-image.ts # 이미지 생성 테스트
    ├── time-warp.ts      # 시간 가속 유틸
    └── virtual-users.ts  # 24개 타임존 가상 유저
```

## 실행 방법

### 환경 설정

```bash
cp .env.example .env
```

`.env` 파일에 필요한 키:

```
GOOGLE_API_KEY=       # Gemini + Imagen 4
TELEGRAM_BOT_TOKEN=   # @beanie_jungbot
ANTHROPIC_API_KEY=    # (선택) Anthropic 폴백
```

### 명령어

```bash
# 의존성 설치
npm install

# DB 초기화
npm run db:init

# 라이브 텍스트 릴레이 (24블록 풀체인)
npm run chain:live

# 라이브 포토 릴레이
npm run chain:photo

# 시뮬레이션 (가속 모드)
npm run sim

# 시뮬레이션 (즉시 완료)
npm run sim:fast
```

## 현재 상태

**MVP 시뮬레이션 완료** — 프로덕션 전 단계

- ✅ Mock 시뮬레이션 (24블록 2.7초)
- ✅ Gemini 2.0 Flash 릴레이 (28.5초)
- ✅ Gemini 2.5 Pro + 로컬 언어 릴레이 (7분 23초, 14개 언어)
- ✅ 선택형 릴레이 게임 포맷 (24블록 17.5분, 에러 0)
- ✅ Imagen 4 포토 릴레이 (3블록 테스트 성공)
- ✅ 사진 검증 (미션 + 안전 필터)
- ✅ Telegram 봇 연동 (@beanie_jungbot)
- 🔧 8개 알려진 이슈 수정 중

## 문서

- [`DESIGN.md`](./DESIGN.md) — 핵심 설계
- [`DESIGN-FULL.md`](./DESIGN-FULL.md) — 상세 설계
- [`MVP-DESIGN.md`](./MVP-DESIGN.md) — MVP 설계
- [`SIMULATION-SCENARIOS.md`](./SIMULATION-SCENARIOS.md) — 시뮬레이션 시나리오
- [`RESEARCH-7-ITEMS.md`](./RESEARCH-7-ITEMS.md) — 리서치 결과

## 라이선스

Private — © 2026 jungchain
