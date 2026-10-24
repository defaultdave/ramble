#!/bin/sh
# Vercel's buildCommand is capped at 256 characters, so the preview migrate logic lives here.
set -e

if [ "$VERCEL_ENV" = "preview" ]; then
  if [ -n "$DATABASE_URL_UNPOOLED" ]; then
    pnpm db:migrate
  else
    echo "Skipping db:migrate: DATABASE_URL_UNPOOLED is not set yet. Redeploy once the Neon integration has made this branch's database."
  fi
fi

pnpm build
