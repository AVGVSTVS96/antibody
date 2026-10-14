#!/bin/sh
# Rebuilds every curated bundle from the tables already on disk, builds the site and deploys it to Vercel
# (project "antibody", linked in apps/web/.vercel). `antibody build` without --no-stages re-runs every stage first.
set -eu
cd "$(dirname "$0")/.."
bun apps/cli/src/main.ts build --no-stages
bun run --cwd apps/web build
cd apps/web
bunx vercel build --prod --yes
bunx vercel deploy --prebuilt --prod --yes
