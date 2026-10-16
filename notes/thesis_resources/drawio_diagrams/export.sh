#!/usr/bin/env bash
# Regenerate the .drawio files from the uf*_A.py scripts and export them to cropped PDFs and PNGs
# with headless draw.io (Docker). Roboto Mono is mounted into the container because the
# exporter blocks Google Fonts and would otherwise fall back to a serif font.
#
#   ./export.sh            # all diagrams
#   ./export.sh uf1_A.py   # selected generators
set -euo pipefail
cd "$(dirname "$0")"

FONTS="${XDG_CACHE_HOME:-$HOME/.cache}/drawio-fonts"
if [ ! -f "$FONTS/RobotoMono-Regular.ttf" ]; then
  mkdir -p "$FONTS"
  for w in Regular Medium Bold; do
    curl -sSfL -o "$FONTS/RobotoMono-$w.ttf" \
      "https://cdn.jsdelivr.net/gh/googlefonts/RobotoMono@main/fonts/ttf/RobotoMono-$w.ttf"
  done
fi

scripts=("$@")
[ ${#scripts[@]} -eq 0 ] && scripts=(uf*_A.py)

for py in "${scripts[@]}"; do
  out=$(python3 - "$py" <<'EOF'
import re, sys
print(re.search(r'd\.save\("([^"]+)"\)', open(sys.argv[1]).read()).group(1))
EOF
)
  python3 "$py"
  # PDF (vector, cropped) and PNG (scale 3 = ~2500 px wide, ~400 dpi at full text width)
  fmt="png --scale 3 --border 4"
  docker run --rm --shm-size=1g -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$FONTS":/usr/share/fonts/truetype/robotomono:ro -v "$PWD":/data \
    rlespinasse/drawio-desktop-headless -x -f $fmt \
    -o "/data/${out%.drawio}.${fmt%% *}" "/data/$out" 2>&1 | grep -- '->' || { echo "export failed: $out" >&2; exit 1; }
done
