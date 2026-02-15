#!/bin/bash
cd "$(dirname "$0")/relay-photos/2026-02-15T13-03-13"

# Get all jpg files in order
FILES=(*.jpg)
INPUTS=""
SCALES=""
for i in $(seq 0 23); do
  INPUTS="$INPUTS -i ${FILES[$i]}"
  SCALES="$SCALES[${i}:v]scale=270:270:force_original_aspect_ratio=increase,crop=270:270[v${i}];"
done

ROW0=""
ROW1=""
for i in $(seq 0 11); do ROW0="${ROW0}[v${i}]"; done
for i in $(seq 12 23); do ROW1="${ROW1}[v${i}]"; done

ffmpeg -y $INPUTS \
  -filter_complex "${SCALES}${ROW0}hstack=inputs=12[row0];${ROW1}hstack=inputs=12[row1];[row0][row1]vstack=inputs=2" \
  -update 1 -q:v 2 /Users/jb/.openclaw/media/outbound/red-chain-grid.jpg 2>/dev/null

ls -la /Users/jb/.openclaw/media/outbound/red-chain-grid.jpg
