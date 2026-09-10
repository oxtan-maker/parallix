#!/usr/bin/env bash
# Records docs/assets/first-value-demo.cast: one real px mission lifecycle in a
# disposable repo. The commands are typed into an interactive shell running on a
# pty, so everything in the cast is a genuine session — prompt, keystrokes, and
# Parallix's own output. Nothing is printed on the session's behalf.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cast="$root/docs/assets/first-value-demo.cast"
command -v asciinema >/dev/null || { echo 'asciinema is required to record the demo' >&2; exit 1; }

parent=$(mktemp -d "${TMPDIR:-/tmp}/parallix-demo-XXXXXX")
repo="$parent/hello-parallix"
slug=parallix-adhoc-0001   # first adhoc mission in a fresh repo (db-owned counter)
[[ -n ${PARALLIX_DEMO_KEEP:-} ]] || trap 'rm -rf "$parent"' EXIT

# Disposable Parallix state: never touch the operator's real home.
export PARALLIX_HOME="$parent/parallix-home"
# `px` on PATH, so the typed command line is the one a user would type.
mkdir -p "$parent/bin"
printf '#!/usr/bin/env bash\nexec node %q "$@"\n' "${PX_BIN:-$root/build/px.mjs}" > "$parent/bin/px"
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
printf '{"adapters":{"verification":{"command":"./scripts/verify-local.sh","defaultArea":"all"},"review":{"provider":"none"},"agents":{"runners":{"custom":"pi"}}}}\n' > workflow.config.json
# Vendor-neutral: each step draws at random from whichever of these is available.
agents='["codex", "claude", "custom"]'
printf '{"steps":{"draft":{"eligible":%s},"active":{"eligible":%s},"review":{"eligible":%s}}}\n' \
  "$agents" "$agents" "$agents" > config/agents.json
git add -A
git commit -qm 'hello world'

python3 - "$cast" "$repo" "$slug" <<'DRIVER'
"""Type the demo commands into a real interactive shell recorded by asciinema."""
import os, pty, re, select, subprocess, sys, time

cast, repo, slug = sys.argv[1:4]
commands = [
    f'px draft "fix hello world greeting"',
    f'cd ../hello-parallix-{slug}',
    f'less missions/{slug}/MISSION.md',
    './scripts/verify-local.sh || echo "Expected: broken greeting rejected"',
    'px active',            # slug is inferred from the worktree
    './scripts/verify-local.sh',
    'git diff main...HEAD -- hello.sh',   # the change under review
    'px integrate',
    'exit',
]

env = dict(os.environ, PS1='$ ', PS2='> ', LESS='-X', SHELL='/bin/bash', TERM='xterm-256color')
master, slave = pty.openpty()
import fcntl, struct, termios
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))

def own_the_tty():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)

proc = subprocess.Popen(
    ['asciinema', 'rec', '--overwrite', '--cols', '100', '--rows', '24',
     '--command', 'bash --norc --noprofile -i', cast],
    cwd=repo, env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_the_tty)
os.close(slave)

tail = ''
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
            tail = (tail + chunk.decode('utf8', 'replace'))[-256:]
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
    if command.startswith('less '):
        time.sleep(5)               # read the mission contract
        os.write(master, b'q\n')    # quit the pager (the newline just redraws the prompt)
    read_until_prompt()

proc.wait()
os.close(master)
DRIVER

node "$root/scripts/retime-first-value-demo.mjs"
