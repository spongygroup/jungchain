#!/bin/bash
# 정봇 헬스체크 — 1시간마다 실행, 결과를 텔레그램으로 전송

BOT_TOKEN="${JUNG_BOT_TOKEN:?JUNG_BOT_TOKEN not set}"
CHAT_ID="${JUNG_ADMIN_CHAT_ID:-5023569703}"
LOG_FILE="/private/tmp/jung-bot.log"

# Check if bot process is running
PID=$(pgrep -f 'node dist/jung-bot.js')

if [ -z "$PID" ]; then
  STATUS="❌ 정봇 다운!"
  DETAIL="프로세스를 찾을 수 없습니다."
else
  # Get process uptime
  STARTED=$(ps -o lstart= -p "$PID" 2>/dev/null | xargs)
  MEM=$(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.1fMB", $1/1024}')

  # Count recent log lines (last hour)
  LOG_LINES=$(tail -100 "$LOG_FILE" 2>/dev/null | wc -l | xargs)

  # Check last log entry
  LAST_LOG=$(tail -1 "$LOG_FILE" 2>/dev/null)

  # DB stats
  DB_PATH="$(dirname "$0")/../data/jung.db"
  USERS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE telegram_id NOT LIKE '9999%' AND telegram_id NOT LIKE '7000%'" 2>/dev/null || echo "?")
  CHAINS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM chains" 2>/dev/null || echo "?")
  BLOCKS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM blocks" 2>/dev/null || echo "?")
  ACTIVE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM chains WHERE status='active'" 2>/dev/null || echo "?")

  STATUS="✅ 정봇 정상 가동 중"
  DETAIL="PID: ${PID}
시작: ${STARTED}
메모리: ${MEM}
로그(최근100줄): ${LOG_LINES}줄

📊 DB 현황
유저: ${USERS} | 체인: ${CHAINS} (활성 ${ACTIVE}) | 블록: ${BLOCKS}"
fi

NOW=$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')
MSG="${STATUS}
${NOW}

${DETAIL}"

# Send to Telegram
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="$CHAT_ID" \
  -d text="$MSG" > /dev/null 2>&1
