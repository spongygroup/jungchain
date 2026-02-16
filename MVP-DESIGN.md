---
tags: [project, jung]
---
# 정 (Jung) — MVP & 테스트 환경 설계
> 빠르게 실행하고 시뮬레이션할 수 있는 최소 구현

---

## 1. MVP 아키텍처

### 기술 스택
| 레이어 | 선택 | 이유 |
|---|---|---|
| 런타임 | **Node.js (TypeScript)** | 텔레그램 봇 생태계, async 처리 |
| 봇 프레임워크 | **grammY** | 경량, TS 네이티브, 미들웨어 패턴 |
| DB | **SQLite (better-sqlite3)** | 로컬 단일파일, MVP에 충분, 나중에 PG 마이그레이션 |
| 스케줄러 | **node-cron** | 인프로세스, 매 정각 트리거 |
| AI | **Claude API (Anthropic SDK)** | 번역 + 맥락 태깅 + 체인 이어붙이기 |
| 날씨 | **OpenWeatherMap API** (무료 티어) | 맥락 태깅용 |
| 해시 | **crypto (내장)** | SHA-256 메시지 해시 |
| 시간 | **luxon** | 타임존 처리 |

### 디렉토리 구조
```
jung/
├── package.json
├── tsconfig.json
├── .env                    # 봇 토큰, API 키
├── src/
│   ├── index.ts            # 엔트리포인트 (봇 시작)
│   ├── bot.ts              # grammY 봇 설정 + 핸들러
│   ├── config.ts           # 환경변수, 상수
│   ├── clock.ts            # 시간 추상화 (실제/가속 모드)
│   ├── modules/
│   │   ├── chain-manager.ts    # 체인 생성/전달/완주/끊김
│   │   ├── scheduler.ts        # 매 정각 체인 전달 로직
│   │   ├── user-manager.ts     # 유저 등록, 타임존별 풀
│   │   ├── ai-jungzigi.ts      # AI 정지기 (번역/맥락/이어붙이기)
│   │   └── message-store.ts    # 메시지 저장/해시/조회
│   ├── db/
│   │   ├── schema.sql          # DDL
│   │   ├── database.ts         # DB 연결 + 쿼리 헬퍼
│   │   └── migrations/
│   ├── sim/                    # 시뮬레이션/테스트 전용
│   │   ├── sim-runner.ts       # 시뮬레이션 실행기
│   │   ├── virtual-users.ts    # 가상 유저 생성
│   │   └── time-warp.ts        # 시간 가속 제어
│   └── types.ts                # 공유 타입 정의
├── tests/
│   ├── chain.test.ts
│   ├── scheduler.test.ts
│   └── sim.test.ts
└── data/
    └── jung.db             # SQLite 파일
```

### 필요한 API/라이브러리
```json
{
  "dependencies": {
    "grammy": "^1.x",
    "better-sqlite3": "^11.x",
    "@anthropic-ai/sdk": "^0.x",
    "luxon": "^3.x",
    "node-cron": "^3.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "@types/better-sqlite3": "^7.x",
    "@types/node-cron": "^3.x"
  }
}
```

---

## 2. 테스트 환경 설계

### 2-1. 시간 추상화 (`clock.ts`)

모든 모듈은 `Date.now()` 대신 `Clock`을 사용한다.

```typescript
interface Clock {
  now(): DateTime;          // 현재 시각
  speed: number;            // 1 = 실시간, 60 = 1분에 1시간
  advance(minutes: number): void;  // 수동 시간 점프
}

class RealClock implements Clock { speed = 1; ... }
class SimClock implements Clock {
  private offset = 0;
  speed = 60; // 기본: 1분 = 1시간
  now() { return DateTime.now().plus({ milliseconds: this.offset }); }
  advance(min: number) { this.offset += min * 60_000; }
}
```

**핵심**: `SIM_MODE=true`이면 SimClock, 아니면 RealClock.

### 2-2. 24개 타임존 시뮬레이션

실제 24시간을 기다리지 않는 방법:

1. **시간 가속 모드**: `SPEED=60` → 1분에 1시간 경과 → **24분에 체인 완주**
2. **즉시 모드**: `SPEED=0` → 스케줄러가 매초 다음 타임존으로 전달 → **24초에 완주**
3. **수동 스텝**: CLI에서 `step` 명령 → 한 타임존씩 수동 전진

```
# 24분에 전체 체인 시뮬레이션
SIM_MODE=true SPEED=60 npm run sim

# 24초에 완주 (빠른 스모크 테스트)
SIM_MODE=true SPEED=0 npm run sim:fast
```

### 2-3. 가상 유저 설정

```typescript
// 24개 타임존에 각 1~3명의 가상 유저
const VIRTUAL_USERS = generateUsers({
  perTimezone: { min: 1, max: 3 },
  totalCount: 48,
  responseRate: 0.7,        // 70% 확률로 응답 (30% = AI 개입 트리거)
  avgResponseDelay: '5m',   // 가속 시간 기준
});
```

가상 유저는 **텔레그램 봇 없이** 내부적으로 메시지를 생성. 
실제 텔레그램 연동 테스트는 별도 (`npm run test:telegram`).

### 2-4. AI 참여자 시뮬레이션

가상 유저가 응답 안 하면 (`responseRate` 미스) → AI 정지기가 자동 개입:

```
시뮬레이션 로그:
[00:00] Chain #14h 시작 (UTC+9, 서울)
[00:00] 가상유저 user_kr_01 → "새벽 2시, 창밖에 눈이 와"
[00:01] → UTC+10 전달 (시드니)
[00:01] 가상유저 user_au_02 → "여기는 3시, 아직 해가 안 졌어"
[00:02] → UTC+11 전달
[00:02] ⚠️ 유저 없음 → AI 정지기 개입
[00:02] AI → "캄차카 반도의 밤, 오로라가 보일까"
...
[00:24] ✅ Chain #14h 완주! 24/24 블록
```

---

## 3. 핵심 모듈 설계

### 3-1. 체인 매니저 (`chain-manager.ts`)

```typescript
class ChainManager {
  // 체인 생성: 매일 24개 (0h~23h)
  createDailyChains(date: string): Chain[];

  // 현재 활성 체인 (이 타임존에서 진행 중인 것)
  getActiveChains(timezone: string): Chain[];

  // 메시지 추가 (유저 or AI)
  addBlock(chainId: string, message: Message): Block;

  // 체인 상태 업데이트
  advanceChain(chainId: string): {
    action: 'delivered' | 'completed' | 'broken';
    nextTimezone?: string;
  };

  // 완주 판정: 24블록 도달
  checkCompletion(chainId: string): boolean;
}
```

**체인 생명주기**:
```
CREATED → ACTIVE → WAITING → (DELIVERED | BROKEN)
                                    ↓
                            ... (24회 반복)
                                    ↓
                              COMPLETED ✅
```

### 3-2. 스케줄러 (`scheduler.ts`)

```typescript
class Scheduler {
  constructor(private clock: Clock, private chainManager: ChainManager) {}

  start() {
    // 실제 모드: 매 정각 실행
    // 시뮬 모드: clock.speed에 따라 가속
    const interval = this.clock.speed === 0
      ? 1000       // 즉시 모드: 매초
      : 3_600_000 / this.clock.speed;  // 가속

    setInterval(() => this.tick(), interval);
  }

  private async tick() {
    const now = this.clock.now();
    const currentHour = now.hour;

    // 1. 현재 시각에 해당하는 타임존들 찾기
    const activeTimezones = getTimezonesAtHour(currentHour);

    // 2. 각 타임존의 활성 체인 처리
    for (const tz of activeTimezones) {
      const chains = this.chainManager.getActiveChains(tz);
      for (const chain of chains) {
        // 응답 없으면 AI 개입 판단
        if (!chain.hasResponseThisHour) {
          await this.aiJungzigi.maybeFillGap(chain);
        }
        // 다음 타임존으로 전달
        this.chainManager.advanceChain(chain.id);
      }
    }
  }
}
```

### 3-3. 유저 매니저 (`user-manager.ts`)

```typescript
class UserManager {
  // 유저 등록 (텔레그램 chat_id + 타임존)
  register(chatId: number, timezone: string): User;

  // 타임존별 유저 풀
  getUsersByTimezone(timezone: string): User[];

  // 체인에 참여할 유저 선택 (랜덤)
  pickParticipant(timezone: string): User | null;

  // 유저 통계
  getStats(userId: string): { chains: number; completions: number; score: number };
}
```

### 3-4. AI 정지기 (`ai-jungzigi.ts`)

```typescript
class AIJungzigi {
  // 체인 갭 채우기 판단
  async maybeFillGap(chain: Chain): Promise<boolean>;

  // 맥락에 맞는 메시지 생성
  async generateMessage(chain: Chain, timezone: string): Promise<string>;

  // 번역 (감정/뉘앙스 보존)
  async translate(text: string, from: string, to: string): Promise<string>;

  // 맥락 태깅 ("서울, 새벽 2시, 눈")
  async tagContext(timezone: string, timestamp: DateTime): Promise<ContextTag>;

  // 체인 회고 생성
  async generateRetrospective(chain: Chain): Promise<string>;
}
```

**프롬프트 전략**:
```
시스템: 너는 "정지기"야. 체인이 끊기지 않도록 메시지를 이어붙여.
- 이전 메시지들의 감정 톤을 읽어
- 현재 타임존의 시각/날씨/분위기를 반영해
- 짧고 따뜻하게. 시적이어도 좋아.
- 사람이 쓴 것처럼 자연스럽게.
```

### 3-5. 메시지 스토어 (`message-store.ts`)

```typescript
class MessageStore {
  // 메시지 저장 + SHA-256 해시 생성
  save(message: Message): { id: string; hash: string };

  // 체인의 모든 메시지 조회 (번역본 포함)
  getChainMessages(chainId: string): Message[];

  // 해시 체인 검증
  verifyChain(chainId: string): boolean;

  // 블록 데이터 생성 (온체인용)
  toBlock(message: Message, prevHash: string): Block;
}
```

---

## 4. 데이터 모델

### Users
```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,           -- uuid
  telegram_id INTEGER UNIQUE NOT NULL,    -- 텔레그램 chat_id
  timezone    TEXT NOT NULL,              -- 'Asia/Seoul', 'America/New_York'
  utc_offset  INTEGER NOT NULL,           -- +9, -5 등 (빠른 조회용)
  is_virtual  BOOLEAN DEFAULT FALSE,      -- 시뮬레이션 유저
  created_at  TEXT DEFAULT (datetime('now')),
  stats_chains     INTEGER DEFAULT 0,
  stats_completions INTEGER DEFAULT 0,
  stats_score      REAL DEFAULT 0.0
);
CREATE INDEX idx_users_offset ON users(utc_offset);
```

### Chains
```sql
CREATE TABLE chains (
  id          TEXT PRIMARY KEY,           -- '2026-02-15-14h'
  date        TEXT NOT NULL,              -- '2026-02-15'
  hour        INTEGER NOT NULL,           -- 0~23 (체인의 "시각")
  status      TEXT DEFAULT 'active',      -- active | completed | broken
  current_tz  INTEGER DEFAULT 0,          -- 현재 진행 중인 UTC 오프셋
  blocks_count INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_chains_status ON chains(status);
CREATE INDEX idx_chains_date ON chains(date);
```

### Messages
```sql
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- uuid
  chain_id    TEXT NOT NULL REFERENCES chains(id),
  block_num   INTEGER NOT NULL,           -- 0~23 (체인 내 순서)
  user_id     TEXT REFERENCES users(id),  -- NULL이면 AI
  is_ai       BOOLEAN DEFAULT FALSE,
  content     TEXT NOT NULL,              -- 원문
  content_translated TEXT,               -- 번역본
  media_type  TEXT,                       -- text | photo | voice
  media_url   TEXT,
  timezone    TEXT NOT NULL,
  utc_offset  INTEGER NOT NULL,
  context_tag TEXT,                       -- JSON: {"city":"서울","weather":"눈","mood":"새벽"}
  hash        TEXT NOT NULL,              -- SHA-256
  prev_hash   TEXT,                       -- 이전 블록 해시
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_chain ON messages(chain_id, block_num);
```

### Blocks (온체인 기록용, Phase 2)
```sql
CREATE TABLE blocks (
  id          TEXT PRIMARY KEY,
  chain_id    TEXT NOT NULL REFERENCES chains(id),
  block_num   INTEGER NOT NULL,
  timezone    TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,           -- unix timestamp
  message_hash TEXT NOT NULL,
  prev_hash   TEXT,
  is_human    BOOLEAN,                    -- NULL = 불명
  tx_hash     TEXT,                       -- 온체인 트랜잭션 해시 (나중에)
  created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## 5. 배포 계획

### Mac mini 로컬 실행

```bash
# 1. 프로젝트 셋업
cd ~/projects/jung
npm install

# 2. 환경변수 (.env)
cp .env.example .env
# 편집

# 3. DB 초기화
npm run db:init

# 4. 실행
npm run dev          # 개발 모드 (tsx watch)
npm run sim          # 시뮬레이션 모드 (24분 완주)
npm run sim:fast     # 빠른 시뮬 (24초)
npm start            # 프로덕션
```

### 환경변수 (`.env`)
```bash
# 텔레그램
TELEGRAM_BOT_TOKEN=         # @BotFather에서 발급

# AI (Claude)
ANTHROPIC_API_KEY=           # Anthropic API 키

# 날씨 (선택)
OPENWEATHER_API_KEY=         # 맥락 태깅용

# 시뮬레이션
SIM_MODE=false               # true = 시뮬레이션 모드
SIM_SPEED=60                 # 가속 배율 (60 = 1분에 1시간)
SIM_USERS_PER_TZ=2           # 타임존당 가상 유저 수

# DB
DB_PATH=./data/jung.db

# 로깅
LOG_LEVEL=info               # debug | info | warn | error
```

### LaunchAgent (Mac mini 자동 시작)
```xml
<!-- ~/Library/LaunchAgents/com.jung.bot.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jung.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/jb/projects/jung/dist/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>/Users/jb/projects/jung</string>
  <key>StandardOutPath</key><string>/tmp/jung-bot.log</string>
  <key>StandardErrorPath</key><string>/tmp/jung-bot-err.log</string>
</dict>
</plist>
```

### npm scripts
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "sim": "SIM_MODE=true SIM_SPEED=60 tsx src/sim/sim-runner.ts",
    "sim:fast": "SIM_MODE=true SIM_SPEED=0 tsx src/sim/sim-runner.ts",
    "db:init": "tsx src/db/init.ts",
    "test": "vitest"
  }
}
```

---

## 6. 구현 우선순위

### Day 1: 뼈대
- [ ] 프로젝트 초기화 (TS + grammY + SQLite)
- [ ] DB 스키마 생성
- [ ] Clock 추상화 (Real/Sim)
- [ ] 텔레그램 봇 기본 (start, 타임존 설정)

### Day 2: 핵심 루프
- [ ] ChainManager (생성/전달)
- [ ] Scheduler (매 정각 tick)
- [ ] MessageStore (저장/해시)
- [ ] 시뮬레이션 러너

### Day 3: AI + 완성
- [ ] AI 정지기 (번역/이어붙이기)
- [ ] 완주/끊김 판정 + 알림
- [ ] 시뮬레이션 24분 완주 테스트
- [ ] 데모 영상용 정리

---

*"24분이면 지구를 한 바퀴 돌 수 있다."*
