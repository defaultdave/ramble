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

# REACT_PROFILING=1 builds with React's profiler enabled, so DevTools' Profiler works on the deployed site.
if [ "$REACT_PROFILING" = "1" ]; then
  pnpm build --profile
else
  pnpm build
fi
