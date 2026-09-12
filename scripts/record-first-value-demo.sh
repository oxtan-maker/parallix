#!/usr/bin/env bash
# Operator-run, real-agent, non-deterministic rehearsal; never a CI gate.
# Its exit status is convenience feedback, not repository gate status.
# Records docs/assets/first-value-demo.cast: one real px mission lifecycle in a
# disposable repo. The commands are typed into an interactive shell running on a
# pty, so everything in the cast is a genuine session — prompt, keystrokes, and
# Parallix's own output. Nothing is printed on the session's behalf.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cast="${DEMO_CAST:-$root/docs/assets/first-value-demo.cast}"
transcript="${DEMO_TRANSCRIPT:-${cast%.cast}.transcript}"
agents=$(python3 - "${ELIGIBLE_AGENT_FAMILIES:-[\"codex\", \"claude\", \"custom\"]}" <<'PY'
import json
import sys

agents = json.loads(sys.argv[1])
if not isinstance(agents, list) or not agents or not all(isinstance(agent, str) and agent for agent in agents):
    raise SystemExit('ELIGIBLE_AGENT_FAMILIES must be a non-empty JSON array of agent-family names')
print(json.dumps(agents))
PY
)
command -v asciinema >/dev/null || { echo 'asciinema is required to record the demo' >&2; exit 1; }
mkdir -p "$(dirname "$cast")" "$(dirname "$transcript")"

parent=$(mktemp -d "${TMPDIR:-/tmp}/parallix-demo-XXXXXX")
repo="$parent/hello-parallix"
slug=parallix-adhoc-0001   # first adhoc mission in a fresh repo (db-owned counter)
[[ -n ${PARALLIX_DEMO_KEEP:-} ]] || trap 'rm -rf "$parent"' EXIT

# Disposable Parallix state: never touch the operator's real home.
export PARALLIX_HOME="$parent/parallix-home"
# `px` on PATH, so the typed command line is the one a user would type.
mkdir -p "$parent/bin"
if [[ -n ${PX_BIN:-} ]]; then
  printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$PX_BIN" > "$parent/bin/px"
else
  printf '#!/usr/bin/env bash\nexec node %q "$@"\n' "$root/build/px.mjs" > "$parent/bin/px"
fi
chmod +x "$parent/bin/px"
export PATH="$parent/bin:$PATH"

mkdir -p "$repo/scripts" "$repo/config"
cd "$repo"
git init -q -b main
git config user.email demo@example.invalid
git config user.name 'Parallix demo'
git config core.pager cat
printf '# Hello world\n\nprintf "Helo, Wrld!\\n"\n' > hello.sh
chmod +x hello.sh
printf 'missions/*/review-events/\n' > .gitignore
printf '#!/usr/bin/env bash\nset -euo pipefail\ntest "$(./hello.sh)" = "Hello, World!"\n' > scripts/verify-local.sh
chmod +x scripts/verify-local.sh
printf '{"adapters":{"verification":{"command":"./scripts/verify-local.sh","defaultArea":"all"},"review":{"provider":"none"},"agents":{"runners":{"custom":"pi"}},"gates":{"requirePreIntegration":true,"preIntegration":[{"key":"verification","command":"./scripts/verify-local.sh all","order":1}]}}}\n' > workflow.config.json
# Vendor-neutral: each step draws at random from whichever of these is available.
printf '{"steps":{"draft":{"eligible":%s},"active":{"eligible":%s},"review":{"eligible":%s}}}\n' \
  "$agents" "$agents" "$agents" > config/agents.json
git add -A
git commit -qm 'hello world'

python3 - "$cast" "$repo" "$slug" "$parent" "$transcript" <<'DRIVER'
"""Type the demo commands into a real interactive shell recorded by asciinema."""
import os, pty, re, select, subprocess, sys, time

cast, repo, slug, parent, transcript = sys.argv[1:6]
commands = [
    f'px draft "fix hello world greeting"',
    f"sed -n '1,120p' missions/{slug}/MISSION.md",
    'px active',            # slug is inferred from the worktree
    'git diff main...HEAD -- hello.sh',   # the change under review
    'px integrate',
    'exit',
]

env = dict(os.environ, PS1='$ ', PS2='> ', LESS='-X', SHELL='/bin/bash', TERM='xterm-256color', VTE_VERSION='')
shell_init = os.path.join(parent, '.first-value-demo.bashrc')
with open(shell_init, 'w', encoding='utf8') as init:
    init.write('PS1="$ "\nPROMPT_COMMAND=\neval "$(px shell-init bash)"\n')
master, slave = pty.openpty()
import fcntl, struct, termios
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 140, 0, 0))

def own_the_tty():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)

proc = subprocess.Popen(
    ['asciinema', 'rec', '--overwrite', '--cols', '140', '--rows', '32',
     '--command', f'bash --noprofile --rcfile {shell_init} -i', cast],
    cwd=repo, env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_the_tty)
os.close(slave)

tail = ''
output = []
def read_until_prompt(idle=0.4, limit=1800):
    """Drain output until the shell is back at its prompt."""
    global tail
    deadline = time.time() + limit
    last = time.time()
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                return
            if not chunk:
                return
            text = chunk.decode('utf8', 'replace')
            output.append(text)
            tail = (tail + text)[-256:]
            last = time.time()
            continue
        if time.time() - last >= idle and re.search(r'\$ $', tail):
            return

read_until_prompt()
for command in commands:
    for char in command:            # keystrokes, not a printed line
        os.write(master, char.encode())
        time.sleep(0.04)
    time.sleep(0.3)
    os.write(master, b'\n')
    read_until_prompt()

proc.wait()
os.close(master)
with open(transcript, 'w', encoding='utf8') as file:
    file.write(''.join(output))
if proc.returncode:
    raise SystemExit(proc.returncode)
DRIVER

grep -Fq '[PASS] ✓ integrated into main' "$transcript" || {
  echo 'demo did not reach integrate; see retained session transcript' >&2
  exit 1
}
grep -Fq 'Repository gate (integration): verification passed.' "$transcript" || {
  echo 'configured repository verification gate was not observed as run; see retained session transcript' >&2
  exit 1
}
node "$root/scripts/retime-first-value-demo.mjs" "$cast"
