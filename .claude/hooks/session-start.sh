#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json). Cloud sessions start from a fresh clone, and the
# environment's setup script installs only machine-level tools, so this installs node_modules.
# It installs only when node_modules is missing or package-lock.json changed since the last
# install, stays quiet when it succeeds and always exits 0: the session starts either way.
set -uo pipefail
[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
[[ -f package-lock.json ]] || exit 0

# sha256 of the lockfile node_modules was installed from. It lives inside node_modules, so
# deleting node_modules resets it, and it is removed before each install so a failed one retries.
stamp=node_modules/.session-start-lock.sha256
lock=$(sha256sum package-lock.json | cut -d' ' -f1)
[[ -d node_modules && "$(cat "$stamp" 2>/dev/null)" == "$lock" ]] && exit 0

# No browser download: Playwright 1.56.1 runs the Chromium build (1194) pre-installed under
# $PLAYWRIGHT_BROWSERS_PATH.
rm -f "$stamp"
log=/tmp/polyreaver-session-start.log
if npm ci --no-audit --no-fund >"$log" 2>&1; then
  mkdir -p node_modules && echo "$lock" >"$stamp"
else
  echo "npm ci failed; see $log"
fi
exit 0
