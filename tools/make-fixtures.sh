#!/bin/sh
# Builds the files test/ui.mjs uploads: 24 PNG photos, a turntable video and a corrupt image.
# Usage: tools/make-fixtures.sh /tmp/fx   (needs node and ffmpeg)
set -e
out="${1:-/tmp/fx}"
node "$(dirname "$0")/mkfixtures.mjs" "$out"
cd "$out"
for f in frame-*.ppm; do ffmpeg -loglevel error -y -i "$f" "${f%.ppm}.png"; done
ffmpeg -loglevel error -y -framerate 12 -i frame-%02d.png -c:v libvpx-vp9 -pix_fmt yuv420p turn.webm
echo "not an image" > notimg.png
