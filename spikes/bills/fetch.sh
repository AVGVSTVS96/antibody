#!/usr/bin/env bash
# usage: spikes/bills/fetch.sh <config.json>... ; downloads every text version and BILLSTATUS into data/bills/raw (no API key)
set -euo pipefail
raw="$(dirname "$0")/../../data/bills/raw"
mkdir -p "$raw"
for cfg in "$@"; do
  python3 -I -c '
import json, sys
c = json.load(open(sys.argv[1]))
print(c["sources"]["billstatus"], c["sources"]["billstatus"].rsplit("/", 1)[1])
for v in c["versions"]:
    print(v["url"], v["file"])
' "$cfg" | while read -r url file; do
    [ -s "$raw/$file" ] || curl -fsSL -o "$raw/$file" "$url"
  done
done
ls -la "$raw"
