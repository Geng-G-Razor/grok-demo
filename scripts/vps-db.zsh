#!/usr/bin/env zsh
set -euo pipefail

SSH_TARGET=${SSH_TARGET:-my-vps-2}
REMOTE_DIR=${REMOTE_DIR:-/home/ubuntu/apps/grok-demo}
REMOTE_DB_DIR=${REMOTE_DB_DIR:-${REMOTE_DIR}/.data}
REMOTE_DB_NAME=${REMOTE_DB_NAME:-razor-chat.db}
LOCAL_DIR=${LOCAL_DIR:-${0:A:h:h}/.remote-db}
KEEP_REMOTE_BACKUP=${KEEP_REMOTE_BACKUP:-0}
OPEN_AFTER_PULL=${OPEN_AFTER_PULL:-0}

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
REMOTE_DB_PATH="${REMOTE_DB_DIR}/${REMOTE_DB_NAME}"
REMOTE_BACKUP_NAME="razor-chat-backup-${TIMESTAMP}.db"
REMOTE_BACKUP_PATH="${REMOTE_DB_DIR}/${REMOTE_BACKUP_NAME}"
LOCAL_BACKUP_PATH="${LOCAL_DIR}/${REMOTE_BACKUP_NAME}"

usage() {
  cat <<EOF
Usage:
  scripts/vps-db.zsh pull

Environment overrides:
  SSH_TARGET=my-vps-2
  REMOTE_DIR=/home/ubuntu/apps/grok-demo
  REMOTE_DB_NAME=razor-chat.db
  LOCAL_DIR=/Users/razor/codex/grok-demo/.remote-db
  KEEP_REMOTE_BACKUP=0
  OPEN_AFTER_PULL=0
EOF
}

if [[ $# -gt 1 ]]; then
  usage
  exit 1
fi

ACTION=${1:-pull}

if [[ "${ACTION}" != "pull" ]]; then
  usage
  exit 1
fi

for cmd in ssh scp mkdir; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd} is required." >&2
    exit 1
  fi
done

mkdir -p "${LOCAL_DIR}"

echo "Preparing SQLite backup from ${SSH_TARGET}"
echo "  remote db: ${REMOTE_DB_PATH}"
echo "  local dir: ${LOCAL_DIR}"

ssh "${SSH_TARGET}" "set -e
if [ ! -f '${REMOTE_DB_PATH}' ]; then
  echo 'Remote database not found: ${REMOTE_DB_PATH}' >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo 'sqlite3 is not installed on the VPS. Run: sudo apt-get update && sudo apt-get install -y sqlite3' >&2
  exit 1
fi

sqlite3 '${REMOTE_DB_PATH}' \".backup '${REMOTE_BACKUP_PATH}'\"
ls -lh '${REMOTE_BACKUP_PATH}'
"

scp "${SSH_TARGET}:${REMOTE_BACKUP_PATH}" "${LOCAL_BACKUP_PATH}"

if [[ "${KEEP_REMOTE_BACKUP}" != "1" ]]; then
  ssh "${SSH_TARGET}" "rm -f '${REMOTE_BACKUP_PATH}'"
fi

if [[ "${OPEN_AFTER_PULL}" == "1" ]]; then
  open -R "${LOCAL_BACKUP_PATH}"
fi

echo "Downloaded backup:"
echo "  ${LOCAL_BACKUP_PATH}"
