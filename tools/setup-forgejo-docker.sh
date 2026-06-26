#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FORGEJO_DIR="${REPO_ROOT}/forgejo"
COMPOSE_FILE="${FORGEJO_DIR}/docker-compose.yml"
STATE_DIR="${REPO_ROOT}/.forgejo-local"
FORCE=0
START=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --start)
      START=1
      shift
      ;;
    --help|-h)
      cat <<EOF
Usage: $0 [--force] [--start]

Creates a minimal Forgejo docker-compose file for the current repo.

Options:
  --force  Overwrite an existing forgejo/docker-compose.yml
  --start  Start the Forgejo container after writing the compose file
EOF
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -f "${COMPOSE_FILE}" && ${FORCE} -ne 1 ]]; then
  echo "[ERROR] ${COMPOSE_FILE} already exists. Use --force to overwrite." >&2
  exit 1
fi

mkdir -p "${FORGEJO_DIR}" "${STATE_DIR}/server"

cat >"${COMPOSE_FILE}" <<'EOF'
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:12
    container_name: ${FORGEJO_CONTAINER_NAME:-workflow-forgejo}
    restart: unless-stopped
    environment:
      USER_UID: ${UID:-1000}
      USER_GID: ${GID:-1000}
      FORGEJO__server__ROOT_URL: ${FORGEJO_ROOT_URL:-http://localhost:3300/}
    ports:
      - "${FORGEJO_PORT:-3300}:3000"
    volumes:
      - ../.forgejo-local/server:/data
EOF

cat <<EOF
[INFO] Wrote ${COMPOSE_FILE}
[INFO] Forgejo data will live in ${STATE_DIR}/server
[INFO] Next steps:
[INFO]   1. docker compose -f forgejo/docker-compose.yml up -d
[INFO]   2. Open http://localhost:\${FORGEJO_PORT:-3300}
[INFO]   3. Create the agent accounts (owner + codex/claude/custom/mistral) with
[INFO]      'forgejo admin user create' — px setup mints tokens but does not create
[INFO]      accounts. See parallix/docs/forgejo-setup.md ("Create the agent accounts").
[INFO]   4. Read parallix/docs/forgejo-setup.md for token and remote wiring
[INFO]   5. Run px setup after export to finish config and review wiring
EOF

if [[ ${START} -eq 1 ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" up -d
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "${COMPOSE_FILE}" up -d
  else
    echo "[ERROR] docker or docker-compose is required for --start" >&2
    exit 1
  fi
  echo "[INFO] Forgejo container started."
fi
