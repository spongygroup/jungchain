#!/bin/bash
DIR="relay-photos/2026-02-15T13-03-13"
OUT="red-chain-video.mp4"
TMPDIR=$(mktemp -d)
cd "$(dirname "$0")"

CITIES=("Seoul" "Taipei" "Bangkok" "Dhaka" "Karachi" "Dubai" "Moscow" "Cairo" "Paris" "London" "Azores" "Mid-Atlantic" "Sao Paulo" "New York" "Chicago" "Denver" "Los Angeles" "Anchorage" "Alaska" "Hawaii" "Samoa" "Auckland" "Solomon Is" "Sydney")

i=0
for jpg in "$DIR"/*.jpg; do
  city="${CITIES[$i]}"
  num=$((i + 1))
  out="$TMPDIR/$(printf '%02d' $i).mp4"
  
  ffmpeg -y -loop 1 -i "$jpg" -t 1.2 \
    -vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,\
drawtext=text='${city}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h-100:font='Helvetica',\
drawtext=text='%{eif\\:${num}\\:d} of 24':fontsize=28:fontcolor=white@0.7:borderw=2:bordercolor=black@0.5:x=(w-text_w)/2:y=h-155:font='Helvetica'" \
    -c:v libx264 -pix_fmt yuv420p -r 30 "$out" 2>/dev/null
  
  if [ $? -eq 0 ]; then
    echo "file '$out'" >> "$TMPDIR/list.txt"
    echo "[$num/24] $city ✅"
  else
    echo "[$num/24] $city ❌"
  fi
  i=$((i + 1))
done

ffmpeg -y -f concat -safe 0 -i "$TMPDIR/list.txt" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT" 2>/dev/null

echo ""
ls -la "$OUT"
rm -rf "$TMPDIR"
