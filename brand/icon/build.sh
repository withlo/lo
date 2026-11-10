#!/usr/bin/env bash
# Rebuilds Lo's app icon from brand/icon/app-icon.svg, on macOS (sips, iconutil and swift come with
# it and the Command Line Tools):
#
#   brand/Lo.iconset/           every size macOS asks for, 16 to 512 pt at @1x and @2x
#   brand/Lo.icns               the iconset, packed
#   brand/icon/Lo.icon/Assets/mark.svg
#                               the mark alone, cropped to the body, for the Icon Composer file
#   brand/icon/sizes.png        the small sizes at 1x and enlarged, on light and dark grounds
#
# At 16, 32 and 64 px, the mark moves by half a pixel at most, so the L's outer edges land on whole
# pixels and stay sharp. The design is the same at every size.
#
# usage: brand/icon/build.sh
set -euo pipefail

cd "$(dirname "$0")/.."
svg=icon/app-icon.svg
iconset=Lo.iconset
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The mark's group: translate(<x> <y>) scale(<s>) translate(-12 -12), so its 76-unit box starts
# at (x, y).
read -r x y s < <(sed -n 's/.*id="mark".*translate(\([0-9.]*\) \([0-9.]*\)) scale(\([0-9.]*\)).*/\1 \2 \3/p' "$svg")
if [[ -z ${s:-} ]]; then
  echo "build.sh: can't find the mark's transform in $svg" >&2
  exit 1
fi

render() {
  local px=$1 out=$2 src=$svg
  if ((px < 128)); then
    # Move the mark so its left and bottom edges round to whole pixels at this size.
    local moved
    moved=$(awk -v x="$x" -v y="$y" -v s="$s" -v px="$px" 'BEGIN {
      k = px / 1024; left = x * k; bottom = (y + 76 * s) * k
      printf "%.3f %.3f", x + (int(left + 0.5) - left) / k, y + (int(bottom + 0.5) - bottom) / k
    }')
    src=$work/app-icon-$px.svg
    sed "s/translate($x $y) scale($s)/translate($moved) scale($s)/" "$svg" > "$src"
  fi
  sips -s format png --resampleHeightWidth "$px" "$px" "$src" --out "$out" > /dev/null
}

rm -rf "$iconset"
mkdir -p "$iconset"
for pt in 16 32 128 256 512; do
  render "$pt" "$iconset/icon_${pt}x${pt}.png"
  render $((pt * 2)) "$iconset/icon_${pt}x${pt}@2x.png"
done
iconutil --convert icns --output Lo.icns "$iconset"

# Icon Composer's canvas is the body, so the layer is the mark with the body's 824 px stretched to
# 1024 points. The fill and the flat look are in Lo.icon/icon.json.
{
  sed -n '1p' "$svg" | sed 's/viewBox="0 0 1024 1024"/viewBox="100 100 824 824"/'
  echo '  <!-- Made by brand/icon/build.sh from brand/icon/app-icon.svg: the mark, cropped to the body. -->'
  sed -n '/id="mark"/,/<\/g>/p' "$svg"
  echo '</svg>'
} > icon/Lo.icon/Assets/mark.svg

swift icon/preview.swift "$iconset" icon/sizes.png

echo "build.sh: made brand/$iconset, brand/Lo.icns, brand/icon/Lo.icon/Assets/mark.svg and brand/icon/sizes.png"
