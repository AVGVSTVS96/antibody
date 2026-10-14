#!/bin/sh
# Rebuilds every curated bundle from the tables already on disk, builds the site and deploys it to production on the
# Vercel project "antibody-v2" (this branch's own site; main deploys to "antibody"). `antibody build` without
# --no-stages re-runs every stage first.
# VERCEL_PROJECT picks another project; SITE_HOST is the host link previews use for og:image (default: the project's
# vercel.app name). `vercel build` run locally does not get Vercel's own VERCEL_PROJECT_PRODUCTION_URL, so we set it.
set -eu
cd "$(dirname "$0")/.."
project="${VERCEL_PROJECT:-antibody-v2}"
export VERCEL_PROJECT_PRODUCTION_URL="${SITE_HOST:-$project.vercel.app}"
bun apps/cli/src/main.ts build --no-stages
bun run --cwd apps/web build
cd apps/web
grep -q "\"projectName\": \"$project\"" .vercel/project.json 2>/dev/null || bunx vercel link --yes --project "$project"
bunx vercel pull --yes --environment=production
bunx vercel build --prod --yes
grep -q "og:image\" content=\"https://$VERCEL_PROJECT_PRODUCTION_URL/og.png\"" .vercel/output/static/index.html
bunx vercel deploy --prebuilt --prod --yes
