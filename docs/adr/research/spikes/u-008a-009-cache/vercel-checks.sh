#!/bin/bash
# Run against a Vercel deployment of this app: ./vercel-checks.sh https://<url>.vercel.app, or ./vercel-checks.sh vc for a protected one (uses `vercel curl`)
# If the preview has Deployment Protection on, add a bypass: export BYPASS=<automation bypass secret>
B="${1%/}"; H=(); [ -n "$BYPASS" ] && H=(-H "x-vercel-protection-bypass: $BYPASS")
if [ "$B" = "vc" ]; then  # protected deployment: use `vercel curl` from this folder
  get() { vercel curl "$1" -- -s 2>/dev/null; }
  hdr() { vercel curl "$1" -- -s -D - -o /dev/null 2>/dev/null; }
else
  get() { curl -s "${H[@]}" "$B$1"; }
  hdr() { curl -s -D - -o /dev/null "${H[@]}" "$B$1"; }
fi
echo "1. CSP per route (dynamic = enforcing nonce, cached = report-only)"
for p in /checkout /manage/abc /ops / /category/kayak /experience/1; do echo "$p: $(hdr $p | grep -i -E '^content-security' | cut -c1-60)"; done
echo "2. Scripts without a nonce on dynamic routes (want 0)"
for p in /ops /checkout /manage/abc; do echo "$p: $(get $p | grep -o -E '<script[^>]*>' | grep -vc nonce)"; done
echo "3. Runtime cache: spaces-left 'ran' time should stay the same for ~8 s across requests, even if different instances serve them"
for i in 1 2 3 4 5 6; do get /experience/1 | grep -o 'spaces left[^<]*' | head -1 | grep -o '2026[^"]*' | head -1; sleep 1; done
echo "4. Set-Cookie / Vary: Cookie on guest routes (want none)"
for p in / /category/kayak /experience/1; do echo "$p: $(hdr $p | grep -i -E '^set-cookie|^vary:.*cookie' | wc -l | tr -d ' ')"; done
echo "5. Tag invalidation: open $B/admin in a browser, click 'revalidateTag max category-kayak', then run:"
echo "   for i in 1 2 3; do curl -s $B/category/kayak | grep -o 'data-stamp[^<]*'; sleep 1; done   # one stale, then fresh"
echo "   and 'updateTag session-1' on /admin, then re-read /experience/1 spaces left: should be a new 'ran' time at once"
