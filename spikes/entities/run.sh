#!/usr/bin/env bash
set -euo pipefail
D=${D:-$HOME/Developer/antibody/data/entities}
T=${T:-$HOME/Developer/antibody/data/trades}
cd "$(dirname "$0")"
cap() { systemd-run --user --scope -p MemoryMax=3G -q "$@"; }
uv run python -I members.py "$D"
cap uv run python -I load_fec.py "$D"
uv run python -I fetch_lda.py "$D/lda"
cap uv run python -I mentions.py "$D" "$T"
uv run python -I resolve.py "$D"
uv run python -I llm_review.py "$D"
cap uv run python -I graph.py "$D" "$T"
uv run python -I report.py "$D/genius.duckdb"
