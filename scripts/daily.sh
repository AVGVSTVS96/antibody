#!/bin/sh
# The daily job. The watcher publishes what it x-rays, rebuilds the index and redeploys production itself.
cd "$(dirname "$0")/.."
exec nice -n 10 bun apps/cli/src/main.ts watch
