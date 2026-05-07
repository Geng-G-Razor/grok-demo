#!/usr/bin/env zsh
set -euo pipefail

SSH_TARGET=${SSH_TARGET:-my-vps-2}
REMOTE_DIR=${REMOTE_DIR:-/home/ubuntu/apps/grok-demo}
REMOTE_DB_DIR=${REMOTE_DB_DIR:-${REMOTE_DIR}/.data}
REMOTE_DB_NAME=${REMOTE_DB_NAME:-razor-chat.db}
SERVICE_NAME=${SERVICE_NAME:-grok-demo.service}
LOCAL_DIR=${LOCAL_DIR:-${0:A:h:h}/.remote-db}
KEEP_REMOTE_BACKUP=${KEEP_REMOTE_BACKUP:-0}
OPEN_AFTER_PULL=${OPEN_AFTER_PULL:-0}
KEEP_REMOTE_REPLACEMENT_BACKUP=${KEEP_REMOTE_REPLACEMENT_BACKUP:-1}
VERIFY_LOCAL_DB=${VERIFY_LOCAL_DB:-1}

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
REMOTE_DB_PATH="${REMOTE_DB_DIR}/${REMOTE_DB_NAME}"
REMOTE_BACKUP_NAME="razor-chat-backup-${TIMESTAMP}.db"
REMOTE_BACKUP_PATH="${REMOTE_DB_DIR}/${REMOTE_BACKUP_NAME}"
LOCAL_BACKUP_PATH="${LOCAL_DIR}/${REMOTE_BACKUP_NAME}"
LOCAL_WORKING_DB_PATH="${LOCAL_DIR}/${REMOTE_DB_NAME}"
REMOTE_UPLOAD_NAME="razor-chat-upload-${TIMESTAMP}.db"
REMOTE_UPLOAD_PATH="${REMOTE_DB_DIR}/${REMOTE_UPLOAD_NAME}"
REMOTE_REPLACEMENT_BACKUP_NAME="razor-chat-before-replace-${TIMESTAMP}.db"
REMOTE_REPLACEMENT_BACKUP_PATH="${REMOTE_DB_DIR}/${REMOTE_REPLACEMENT_BACKUP_NAME}"

usage() {
  cat <<EOF
Usage:
  scripts/vps-db.zsh pull
  scripts/vps-db.zsh push /path/to/local.db

Environment overrides:
  SSH_TARGET=my-vps-2
  REMOTE_DIR=/home/ubuntu/apps/grok-demo
  REMOTE_DB_NAME=razor-chat.db
  SERVICE_NAME=grok-demo.service
  LOCAL_DIR=/Users/razor/codex/grok-demo/.remote-db
  KEEP_REMOTE_BACKUP=0
  OPEN_AFTER_PULL=0
  KEEP_REMOTE_REPLACEMENT_BACKUP=1
  VERIFY_LOCAL_DB=1
EOF
}

if [[ $# -gt 2 ]]; then
  usage
  exit 1
fi

ACTION=${1:-pull}
LOCAL_DB_PATH=${2:-}

if [[ "${ACTION}" != "pull" && "${ACTION}" != "push" ]]; then
  usage
  exit 1
fi

for cmd in ssh scp mkdir; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd} is required." >&2
    exit 1
  fi
done

if [[ "${ACTION}" == "pull" ]]; then
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
  cp "${LOCAL_BACKUP_PATH}" "${LOCAL_WORKING_DB_PATH}"

  if [[ "${KEEP_REMOTE_BACKUP}" != "1" ]]; then
    ssh "${SSH_TARGET}" "rm -f '${REMOTE_BACKUP_PATH}'"
  fi

  if [[ "${OPEN_AFTER_PULL}" == "1" ]]; then
    open -R "${LOCAL_WORKING_DB_PATH}"
  fi

  echo "Downloaded backup and working copy:"
  echo "  backup:  ${LOCAL_BACKUP_PATH}"
  echo "  working: ${LOCAL_WORKING_DB_PATH}"
  exit 0
fi

if [[ -z "${LOCAL_DB_PATH}" ]]; then
  usage
  exit 1
fi

if [[ ! -f "${LOCAL_DB_PATH}" ]]; then
  echo "Local database not found: ${LOCAL_DB_PATH}" >&2
  exit 1
fi

if [[ "${VERIFY_LOCAL_DB}" == "1" ]]; then
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "Local sqlite3 is required when VERIFY_LOCAL_DB=1." >&2
    exit 1
  fi

  integrity_result=$(sqlite3 "${LOCAL_DB_PATH}" "PRAGMA integrity_check;")
  if [[ "${integrity_result}" != "ok" ]]; then
    echo "Local database integrity check failed:" >&2
    echo "${integrity_result}" >&2
    exit 1
  fi
fi

echo "Uploading SQLite database to ${SSH_TARGET}"
echo "  local db:  ${LOCAL_DB_PATH}"
echo "  remote db: ${REMOTE_DB_PATH}"

scp "${LOCAL_DB_PATH}" "${SSH_TARGET}:${REMOTE_UPLOAD_PATH}"

ssh "${SSH_TARGET}" "set -e
if [ ! -f '${REMOTE_UPLOAD_PATH}' ]; then
  echo 'Uploaded database not found: ${REMOTE_UPLOAD_PATH}' >&2
  exit 1
fi

sudo systemctl stop '${SERVICE_NAME}'

if [ -f '${REMOTE_DB_PATH}' ]; then
  cp '${REMOTE_DB_PATH}' '${REMOTE_REPLACEMENT_BACKUP_PATH}'
fi

mv '${REMOTE_UPLOAD_PATH}' '${REMOTE_DB_PATH}'
rm -f '${REMOTE_DB_PATH}-wal' '${REMOTE_DB_PATH}-shm'

sudo systemctl start '${SERVICE_NAME}'
systemctl is-active '${SERVICE_NAME}'

if [ '${KEEP_REMOTE_REPLACEMENT_BACKUP}' != '1' ]; then
  rm -f '${REMOTE_REPLACEMENT_BACKUP_PATH}'
fi

ls -lh '${REMOTE_DB_PATH}'
"

echo "Remote database replaced successfully."
echo "  remote db: ${REMOTE_DB_PATH}"
if [[ "${KEEP_REMOTE_REPLACEMENT_BACKUP}" == "1" ]]; then
  echo "  remote backup kept: ${REMOTE_REPLACEMENT_BACKUP_PATH}"
fi
