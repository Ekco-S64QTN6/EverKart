#!/bin/sh
# Track-select previews: a frame from a few seconds into an autopilot race on each track,
# without the HUD.  Needs the dev server (npm run dev).
#   sh tools/previews.sh veeshan kael ...      -> public/ui/track_<id>.jpg
cd "$(dirname "$0")/.." || exit 1
tmp=$(mktemp -d)
for t in "$@"; do
  node tools/shot.mjs "http://localhost:5199/?track=$t&mute&autopilot&nohud" "$tmp/$t" 16 >/dev/null 2>&1
  ffmpeg -y -loglevel error -i "$tmp/$t/t016.png" -vf scale=640:360 -q:v 3 "public/ui/track_$t.jpg" && echo "$t ok"
done
rm -rf "$tmp"
