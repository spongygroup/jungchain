# Changelog

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

### 알려진 이슈
1. 선택지가 다른 유저에게 안 보임
2. 번역 시 도시명 세그멘테이션
3. 장르 드리프트 (로맨스→스릴러)
4. 컨텍스트 윈도우 제한 (최근 5개)
5. 정지기가 로컬어 대신 한국어 사용
6. 일부 유저가 지정언어 대신 영어 사용
7. 대량 번역 토큰 제한
8. 진행 리포트 타이밍 최적화 필요
