#!/bin/sh
# Rebuilds every curated bundle from the tables already on disk, builds the site and deploys it to Vercel
# (project "antibody", root directory apps/web, so the CLI runs from the repo root, linked in .vercel). `antibody build` without --no-stages re-runs every stage first.
set -eu
cd "$(dirname "$0")/.."
bun apps/cli/src/main.ts build --no-stages
bun run --cwd apps/web build
[ -f .vercel/project.json ] || { mkdir -p .vercel && cp apps/web/.vercel/project.json .vercel/project.json; }
bunx vercel build --prod --yes
bunx vercel deploy --prebuilt --prod --yes
