# Changelog

## [0.4.2] — 2026-02-21

### NFT 이미지 생성

- resvg-js 기반 SVG→PNG 변환 (puppeteer/Chrome 불필요)
- Noto Sans KR 폰트 서브셋 임베딩 (정+情, 3KB)
- 1600px 고해상도 렌더링
- NFT 콜백: 선택 메시지 삭제 → NFT 이미지 전송 → 완주 앨범 전송

### 완주 알림 개선

- 참여자 수에서 체인 시작자 제외 (othersCount)
- 솔로 완주 메시지 추가 (`complete_solo`)
- 도시 표시: 타임존 기본 도시 → 유저 등록 도시
- 블록 목록 → 도시 루트 포맷 (`🇰🇷 성남시 → 🇯🇵 도쿄 → ...`)

### 크론 최적화

- 매시 → 매분 크론으로 변경 (분 단위 체인 만료 처리)
- 어사인먼트 만료, NFT 자동 민팅, 릴레이 배정은 정시에만 실행

### i18n

- `nft_style_choice`: "당신의 정을 한자로 남길까요, 한글로 남길까요?"
- `nft_minted`: 간소화 (이미지 캡션용)
- `complete_solo`: 17개 언어 추가

## [0.4.1] — 2026-02-20

### 보안

- AI 검증 이중 폴백: Gemini → OpenAI gpt-4o-mini (텍스트/사진 모두)
- 프롬프트 인젝션 방어: `<USER_CONTENT>` / `<MISSION>` 구조화 태그
- `/devstart` 관리자 전용 guard (`JUNG_ADMIN_CHAT_ID`)
- 콜백 소유권 검증: `isChainParticipant()`, `assignment.user_id` 체크
- 콜백 NaN/범위 검증 (variant 0~1)
- CDP 인증 경로 환경변수 오버라이드 (`CDP_CREDENTIALS_PATH`) + 권한 검증
- `.env`, `wallets.json` 파일 권한 강화 (chmod 600)
- 컨트랙트 v8: `transferOperator` + `acceptOperator` 2단계 키 로테이션
- 보안 감사 문서 gitignore 처리

## [0.4.0] — 2026-02-20

### 완주 앨범

- 체인 완주 시 동적 HTML 앨범 생성 (`src/services/album.ts`)
- 사진 WebP 변환 + base64 임베딩 (자체 완결 HTML)
- 캡션 자동 번역 (수신자 언어 ≠ 작성자 언어일 때)
- NFT 히어로 + 카드 레이아웃 + IntersectionObserver 애니메이션
- 3곳에서 앨범 전송: NFT 콜백, 24h 자동 민팅, 온체인 비활성 경로

### 소울바운드 NFT

- JungSoulbound v7 컨트랙트 (情 hanja / 정 hangul 배리언트)
- 체인 완주 → 유저에게 NFT 스타일 선택 인라인 버튼 전송
- 24h 미선택 시 기본값(情)으로 자동 민팅
- 체인 상태 라이프사이클: active → completed → notified → delivered

### 문서

- README 전면 개편 (사용방법, 실행방법, 현재 상태)
- 완주 앨범 + 정나무 숲 스크린샷 추가
- CHANGELOG v0.2.0–v0.4.0 작성
- 보안: healthcheck.sh 토큰 노출 수정 + 히스토리 정리

## [0.3.0] — 2026-02-19

### 정나무 (포크 시스템)

- Copy-on-Fork: 같은 타임존에 여러 참여자 → 가지 분기
- DB 스키마: `parent_chain_id`, `fork_slot`, `root_chain_id`
- 시간 기반 완주: 루트 체인 시작 후 24h 자동 완료
- 시뮬레이션 검증: 100유저 × 24TZ → 5개 루트, 274체인, 3,576블록
- 포크 트리 시각화: `docs/jung-tree.html` (Canvas 애니메이션)

### 온체인 기록

- Base Sepolia 배포 (JungBlock + JungSoulbound)
- `keccak256("jung-{chainId}")` 해시 기반 온체인 ID
- 블록별 해시 기록 + 2초 딜레이 (nonce 안전)
- 24블록 선형 테스트 통과

## [0.2.0] — 2026-02-19

### 다국어 지원 (17개 언어)

- ko, en, ja, zh, th, es, pt, fr, ar, ru, de, it, tr, hi, id, vi, uk
- 정 용어 현지화: ko=정, ja=情(じょう), en=정(Jung)
- `tAsync()`: Gemini 자동 번역 + DB 캐시
- 도시명 17개 언어 사전 번역 (`city_i18n` JSON)
- 메뉴/버튼/알림 전체 i18n

### UX 개선

- /start와 /menu 완전 분리
- 메뉴 콜백: `editMessageText` 우선, 빈 채팅 방지
- /start 2초 디바운스 (텔레그램 중복 전송 방지)
- 사진 타임스탬프 캡션 (YYYY.MM.DD HH:MM UTC+X)
- 유저 커맨드 메시지 자동 삭제

### 봇 아키텍처 전환

- v5 레거시 코드 정리 (46개 파일 삭제)
- 엔트리포인트: `src/index.ts` → `src/jung-bot.ts`
- CDP 지갑 자동 생성 (비동기, `.then()` 패턴)
- Gemini 2.0 Flash 통합 (검증/번역/STT)
- 정지기(AI 모더레이터) 콘텐츠 검증 + 코멘트

## [0.1.1] — 2026-02-15

### 포토 릴레이 v2 (`live-relay-photo.ts`)

**이미지 저장**
- 매 블록 로컬 저장: `data/relay-photos/{runId}/{block}-{city}.jpg` + `.json`
- Human 사진도 Telegram에서 다운로드 후 저장

**유저 경험 개선**
- 진행 알림: 사진 제거 → 텍스트만 (✈️ 출발, 🌍 5블록마다, 🌍 거의 도착)
- 다음 유저에게 직전 사진+캡션 이미지로 전달 (Gemini 멀티모달 입력)
- 미션 텍스트 매 블록 전달
- 몇 번째인지 표시 (#N of 24)

**사진 스타일**
- 스톡포토급 → 일상 폰사진 스타일로 프롬프트 변경
- Imagen 4 비율 랜덤: 1:1, 3:4, 4:3, 9:16
- 유저별 랜덤 성격 4종: lazy texter / enthusiastic / chill / storyteller
- 사진 장면 랜덤 4종: 책상 위 / 걸으면서 / 음식 / 집에서
- 도시별 문화 톤 반영 (로컬 슬랭, 유머 스타일)

## [0.1.0] — 2026-02-15

### 초기 MVP

**코어 아키텍처**
- ChainManager, Scheduler, UserManager, MessageStore, AIJungzigi 모듈 구현
- SQLite DB 스키마 설계 (users, chains, blocks, messages)
- 24개 타임존 가상 유저 프로필 (21명 + AI 정지기 3명)
- `geo-tz` 기반 좌표→타임존 변환, Nominatim 역지오코딩

**시뮬레이션 진화**
- Mock 모드: 24블록 2.7초 (하드코딩 메시지)
- Gemini 2.0 Flash: 24블록 28.5초 (AI 생성, 영어)
- Gemini 2.5 Pro: 24블록 7분 23초 (14개 로컬 언어)
- 스토리 릴레이: 24블록 17.5분 (이야기 + A/B 선택지, 에러 0)

**포토 릴레이**
- Imagen 4 REST API 연동 (`imagen-4.0-generate-preview-06-06`)
- 3블록 테스트 성공 (서울 → 타이페이 → 방콕)
- `validatePhoto`: Gemini Vision 기반 미션 체크 + 안전 필터 (개인정보, NSFW 감지)

**Telegram 봇**
- @beanie_jungbot 봇 연동 (grammY)
- 온보딩: 위치 공유 → 타임존 자동 등록
- 릴레이 메시지 실시간 전송 (5초 간격)
- 진행 리포트 (시작, 내 차례 예고, 5블록마다, 완료)
- 4096자 자동 분할, 3회 재시도 로직

**AI 정지기**
- 빈 타임존(UTC+11, UTC-1, UTC-9) AI가 로컬 언어로 채움
- 릴레이 컨텍스트 최근 5개 메시지 참조
- 전체 체인 한국어 번역 (완료 시 자동 전송)

**인프라**
- TypeScript + tsx 개발환경
- `.env` 기반 API 키 관리
- GitHub org `jungchain` + Private repo

**포토 릴레이 풀 완주**
- 24블록 전체 완주: 792초 (~13.2분), 에러 0
- 블록당 평균 ~33초 (Gemini 텍스트 + Imagen 4 이미지)
- 미션: "당신 주위의 빨강을 보여주세요!"
- JB 타바스코 사진 → 타이베이 우체통 → 방콕 → ... → 시드니

### 알려진 이슈
1. 선택지가 다른 유저에게 안 보임
2. 번역 시 도시명 세그멘테이션
3. 장르 드리프트 (로맨스→스릴러)
4. 컨텍스트 윈도우 제한 (최근 5개)
5. 정지기가 로컬어 대신 한국어 사용
6. 일부 유저가 지정언어 대신 영어 사용
7. 대량 번역 토큰 제한
8. 진행 리포트 타이밍 최적화 필요
