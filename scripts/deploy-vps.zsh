#!/usr/bin/env zsh
set -euo pipefail

APP_NAME=${APP_NAME:-grok-demo}
SSH_TARGET=${SSH_TARGET:-my-vps-2}
REMOTE_DIR=${REMOTE_DIR:-/home/ubuntu/apps/grok-demo}
SERVICE_NAME=${SERVICE_NAME:-grok-demo.service}
PUBLIC_URL=${PUBLIC_URL:-http://111.229.36.50/}
RUN_INSTALL=${RUN_INSTALL:-0}
RESTART_SERVICE=${RESTART_SERVICE:-1}

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${PROJECT_DIR:-${SCRIPT_DIR:h}}

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required." >&2
  exit 1
fi

echo "Deploying ${APP_NAME}"
echo "  local:  ${PROJECT_DIR}"
echo "  remote: ${SSH_TARGET}:${REMOTE_DIR}"
echo "  install dependencies: ${RUN_INSTALL}"

ssh "${SSH_TARGET}" "mkdir -p '${REMOTE_DIR}'"

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".data" \
  --exclude ".vercel" \
  --exclude ".idea" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  --exclude ".env.*" \
  "${PROJECT_DIR}/" \
  "${SSH_TARGET}:${REMOTE_DIR}/"

ssh "${SSH_TARGET}" "set -e
cd '${REMOTE_DIR}'
rm -rf .vercel .idea
rm -f .env .env.*

if [ '${RUN_INSTALL}' = '1' ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo 'pnpm is not installed on the VPS.' >&2
    exit 1
  fi
  pnpm install --prod --frozen-lockfile
fi

if [ '${RESTART_SERVICE}' = '1' ]; then
  sudo systemctl restart '${SERVICE_NAME}'
fi

systemctl is-active '${SERVICE_NAME}'
if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
  systemctl is-active nginx.service
fi

check_url() {
  label=\"\$1\"
  url=\"\$2\"
  attempt=1

  while [ \"\$attempt\" -le 20 ]; do
    result=\$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \"\$url\" || true)
    code=\${result%% *}

    if [ \"\$code\" != '000' ]; then
      echo \"\$label: \$result\"
      return 0
    fi

    sleep 1
    attempt=\$((attempt + 1))
  done

  echo \"\$label: not reachable\" >&2
  return 1
}

check_url 'local app' 'http://127.0.0.1:3210/login.html'
check_url 'public url' '${PUBLIC_URL}'"

echo "Done."
