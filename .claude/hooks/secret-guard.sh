#!/usr/bin/env bash
# cloud-kit: runs only in cloud sessions; local sessions already run the user-level copy.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
# secret-guard.sh — PreToolUse hook (matcher: Bash) for every project on this machine.
# Blocks shell commands that name a secret file, whichever program would read it.
# Exit 2 blocks the call and sends stderr back as the reason; exit 0 allows it.
# Fails open when jq is unavailable so a broken hook never takes Bash down.
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
[[ "$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Template files are not secrets.
SCRUBBED=$(printf '%s' "$CMD" | sed -E 's/\.env\.(example|sample|template)//g')

SQ="'"
DELIM="[[:space:]\"${SQ}()=]"
PATTERN="(^|${DELIM}|/)(\\.env(\\.[A-Za-z0-9_-]+)?|credentials\\.json|id_rsa|id_ed25519|\\.npmrc|\\.pypirc)(${DELIM}|$)"
PATTERN="${PATTERN}|\\.(pem|key|p12|pfx)(${DELIM}|$)|\\.aws/credentials|\\.gnupg/|\\.claude/\\.credentials\\.json"

if printf '%s' "$SCRUBBED" | grep -Eq "$PATTERN"; then
  echo "secret-guard blocked this command because it names a secret file (.env, private key, or credentials). Ask the user for the value instead; template files such as .env.example are allowed." >&2
  exit 2
fi
exit 0
