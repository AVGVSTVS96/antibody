#!/bin/sh
# The daily job: the watcher (finds moving bills, x-rays the top few, writes data/watch/<date>.md), then the site
# is rebuilt with its picks and deployed. The watcher exits 2 when its digest lists a problem; the deploy still runs.
cd "$(dirname "$0")/.."
ANTIBODY_WATCH_PUBLISH=1 nice -n 10 bun apps/cli/src/main.ts watch
status=$?
[ "$status" -le 2 ] && scripts/deploy.sh
exit "$status"
