#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_VERSION="$(node -p "require('$PACKAGE_ROOT/package.json').version")"
SLUG="${1:-task-enterprise-hello}"
TRANSFER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/px-enterprise-transfer-XXXXXX")"
RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/px-enterprise-runtime-XXXXXX")"
TARGET_REPO="$(mktemp -d "${TMPDIR:-/tmp}/px-enterprise-target-XXXXXX")"
REMOTE_REPO="$(mktemp -d "${TMPDIR:-/tmp}/px-enterprise-origin-XXXXXX")"
FAKE_AGENT_BIN="$(mktemp -d "${TMPDIR:-/tmp}/px-enterprise-agent-bin-XXXXXX")"
FAKE_AGENT="$FAKE_AGENT_BIN/codex"

cleanup() {
  git -C "$TARGET_REPO" worktree remove "../$(basename "$TARGET_REPO")-$SLUG" --force >/dev/null 2>&1 || true
  rm -rf "$TRANSFER_DIR" "$RUNTIME_DIR" "$TARGET_REPO" "$REMOTE_REPO" "$FAKE_AGENT_BIN"
}
trap cleanup EXIT

chmod 700 "$TRANSFER_DIR" "$RUNTIME_DIR" "$TARGET_REPO" "$REMOTE_REPO" "$FAKE_AGENT_BIN"

cat > "$FAKE_AGENT" <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail

slug="${PX_ENTERPRISE_SMOKE_SLUG:?PX_ENTERPRISE_SMOKE_SLUG is required}"
year="${PX_ENTERPRISE_SMOKE_YEAR:?PX_ENTERPRISE_SMOKE_YEAR is required}"
mission_dir="docs/missions/$year/$slug"
task_file="$(find backlog/tasks -maxdepth 1 -type f -name "*$slug*.md" | head -n 1)"

mkdir -p "$mission_dir"

if [ -f "$mission_dir/MISSION.md" ]; then
  cat > "$mission_dir/MISSION.md" <<EOF
# Mission: Hello World parallix Proof ($slug)

## Goal
Create one hello-world file through the packaged parallix workflow.

## Why Now
This proves the enterprise tarball can run against a separate target repository.

## Scope
- Create hello.txt with one tested line.

## Out of Scope
- Production deploys.

## Success Criteria
- [ ] hello.txt contains "hello from px enterprise smoke".

## Risks and Assumptions
- Fake local agent is used only for package smoke proof.

## Checkpoints
- CP 1: Create hello.txt and record proof.

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not run production deploy scripts.

## Stop Rules
- Stop if the package runtime is copied into the target repo.
EOF
fi

if [ -n "$task_file" ]; then
  cat > "$task_file" <<EOF
---
id: ${slug^^}
title: Hello world package proof
status: refined
assignee:
  - codex
created_date: '2026-06-05 00:00'
labels:
  - ai_sdlc
---

## Description

Create a hello-world file through packaged parallix in this example repo.
EOF
fi

cat > hello.txt <<'EOF'
hello from px enterprise smoke
EOF

cat > "$mission_dir/CP-1.md" <<'EOF'
# CP-1: Hello world package proof

## Summary

The packaged parallix `px` runner created this checkpoint in a temporary target
repository while the parallix runtime stayed outside the target repository.

## Goal Check

| Goal | Status | Evidence |
|---|---|---|
| hello.txt created | DONE | hello.txt contains the expected smoke text. |

Next action: handoff the temporary mission for review.
EOF
AGENT
chmod +x "$FAKE_AGENT"

git init --bare "$REMOTE_REPO" >/dev/null
git -C "$TARGET_REPO" init -b main >/dev/null
git -C "$TARGET_REPO" config user.email "px-enterprise@example.invalid"
git -C "$TARGET_REPO" config user.name "Px Enterprise Smoke"
git -C "$TARGET_REPO" remote add origin "$REMOTE_REPO"

mkdir -p "$TARGET_REPO/backlog/tasks" "$TARGET_REPO/scripts" "$TARGET_REPO/docs/missions"
cat > "$TARGET_REPO/backlog/tasks/$SLUG - hello-world.md" <<EOF
---
id: ${SLUG^^}
title: Hello world package proof
status: backlog
assignee: []
created_date: '2026-06-05 00:00'
labels:
  - ai_sdlc
---

## Description

Create a hello-world file through packaged parallix in this example repo.
EOF

cat > "$TARGET_REPO/scripts/verify-local.sh" <<'VERIFY'
#!/usr/bin/env bash
set -euo pipefail
area="${1:-docs}"
case "$area" in
  docs|all)
    find docs -name '*.md' -print >/dev/null
    ;;
  *)
    ;;
esac
exit 0
VERIFY
chmod +x "$TARGET_REPO/scripts/verify-local.sh"

cat > "$TARGET_REPO/workflow.config.json" <<'CONFIG'
{
  "product": {
    "name": "Enterprise Px Smoke"
  },
  "adapters": {
    "tasks": { "provider": "backlog-md", "storage": "backlog" },
    "missions": {
      "baseDir": "docs/missions",
      "branchPrefix": "mission/",
      "worktreePattern": "../<repo>-<slug>"
    },
    "verification": {
      "command": "./scripts/verify-local.sh {{area}}",
      "defaultArea": "docs"
    },
    "review": { "provider": "none" },
    "agents": {}
  }
}
CONFIG

git -C "$TARGET_REPO" add -A
git -C "$TARGET_REPO" commit -m "example: install backlog hello world ticket" >/dev/null
git -C "$TARGET_REPO" push -u origin main >/dev/null

PACK_JSON="$(npm pack "$PACKAGE_ROOT" --json --pack-destination "$TRANSFER_DIR")"
TARBALL="$(node -e "const p=JSON.parse(process.argv[1]); console.log(p[0].filename)" "$PACK_JSON")"
TARBALL_PATH="$TRANSFER_DIR/$TARBALL"
SHA256="$(sha256sum "$TARBALL_PATH" | awk '{print $1}')"

# The enterprise runtime is `npm install -g <tarball>`, which puts a single `px`
# on PATH and replaces any prior install. RUNTIME_DIR is an isolated global
# prefix so this smoke never touches the machine's real global install.
npm_config_prefix="$RUNTIME_DIR" npm install -g "$TARBALL_PATH" >/dev/null 2>&1
export PATH="$FAKE_AGENT_BIN:$RUNTIME_DIR/bin:$PATH"

VERSION_OUTPUT="$(px --version)"

(
  export PX_ENTERPRISE_SMOKE_SLUG="$SLUG"
  export PX_ENTERPRISE_SMOKE_YEAR="2026"
  export WORKFLOW_AGENT="codex"
  cd "$TARGET_REPO"
  px config >/dev/null
  px status "$SLUG" >/dev/null
  px draft "$SLUG" >/dev/null
)

MISSION_WORKTREE="$(dirname "$TARGET_REPO")/$(basename "$TARGET_REPO")-$SLUG"

(
  export PX_ENTERPRISE_SMOKE_SLUG="$SLUG"
  export PX_ENTERPRISE_SMOKE_YEAR="2026"
  export WORKFLOW_AGENT="codex"
  cd "$MISSION_WORKTREE"
  px handoff "$SLUG" --no-gate >/dev/null
)

(
  cd "$MISSION_WORKTREE"
  px review-event "$SLUG" \
    --type human_note \
    --actor px-enterprise-smoke \
    --content "packaged px enterprise smoke completed" \
    --timestamp "2026-06-05T120000" \
    --skip-git >/dev/null
)

test -f "$MISSION_WORKTREE/hello.txt"
grep -q "hello from px enterprise smoke" "$MISSION_WORKTREE/hello.txt"
test -f "$MISSION_WORKTREE/docs/missions/2026/$SLUG/CP-1.md"
test -f "$MISSION_WORKTREE/docs/missions/2026/$SLUG/review-events/2026-06-05T120000-human_note-1-px-enterprise-smoke.md"
test ! -d "$TARGET_REPO/parallix"
test ! -d "$MISSION_WORKTREE/parallix"
grep -q "parallix $PACKAGE_VERSION" <<<"$VERSION_OUTPUT"

# Exactly one px must be installed in the global prefix, and its px.js must live
# there -- never inside the target repo or mission worktree. This is the single
# runtime + runtime/target boundary assertion.
INSTALL_COUNT="$(find "$RUNTIME_DIR/lib/node_modules" -maxdepth 1 -name parallix -type d | wc -l)"
test "$INSTALL_COUNT" -eq 1 || { echo "FAIL: expected exactly one px install, found $INSTALL_COUNT" >&2; exit 1; }

PX_JS="$(sed -n 's/^px: //p' <<<"$VERSION_OUTPUT")"
test -n "$PX_JS"
grep -q "node_modules/parallix/px.js" <<<"$PX_JS"
case "$PX_JS" in
  "$RUNTIME_DIR"/*) : ;;  # expected: under the global prefix
  "$TARGET_REPO"/*|"$MISSION_WORKTREE"/*)
    echo "FAIL: px.js resolved inside target/worktree: $PX_JS" >&2
    exit 1
    ;;
  *)
    echo "FAIL: px.js resolved outside the global prefix: $PX_JS" >&2
    exit 1
    ;;
esac

cat <<EOF
PASS enterprise tarball workflow smoke
transfer_dir=$TRANSFER_DIR
target_repo=$TARGET_REPO
mission_worktree=$MISSION_WORKTREE
tarball=$TARBALL_PATH
px_js=$PX_JS
sha256=$SHA256
version=$(head -n 1 <<<"$VERSION_OUTPUT")
EOF
