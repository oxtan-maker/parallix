# Mission: Bubblewrap Guard — optional agent sandboxing via bubblewrap (task-2374)

## Goal
Add an optional bubblewrap (bbwrap) sandbox layer around agent invocations so agents are confined to their worktree directory and any prompt-specified directories. When bubblewrap is unavailable, emit a warning and fall back to unsandboxed execution.

## Why Now
Agents currently run with full filesystem access. This is intentional — standard sandboxing (e.g. Codex's built-in sandbox) breaks agent flow. A lightweight bubblewrap wrapper gives operators opt-in isolation without forcing it. This plugs a security gap before agents run untrusted or shared workloads.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new module (~1 file), thin wrapper around spawn-tee, one path-probe check, warning log when unavailable

## Scope
- Detect bubblewrap availability (`command -v bbwrap` or `commandInPath`)
- Wrap agent child-process invocation with bubblewrap sandbox args (bind worktree, readonly root, allow specific dirs)
- Emit warning log when bubblewrap is not found on PATH
- Integrate into agent launch path so all families (codex, claude, vibe, opencode, pi, qwen, custom) get sandboxed when available
- Configuration flag or env var to enable/disable (default: enabled when available)

## Out of Scope
- Full seccomp/network isolation profiles (future)
- Sandboxing the px CLI itself (only agent child processes)
- Non-Linux platforms (bubblewrap is Linux-only; other platforms get warning + no-op)
- Per-agent sandbox policy customization
- Prompt-specified directory parsing beyond worktree root

## Success Criteria
- SC1: `bbwrap` presence detected via `commandInPath('bbwrap')` or equivalent; detection result cached after first check
- SC2: When bubblewrap is available and enabled, agent child process is invoked through `bbwrap` with at least `--bind <worktree> <worktree>` and `--ro-bind / /` (readonly root filesystem)
- SC3: When bubblewrap is unavailable, a `WARN`-level log is emitted once per process lifetime citing "bubblewrap not found" and execution continues unsandboxed
- SC4: No agent family (codex, claude, vibe, opencode, pi, qwen, custom) regresses — all existing test suites pass unchanged
- SC5: Existing spawn-tee contract (stdout/stderr piping, exit codes, signal handling) preserved through bubblewrap wrapper

## Risks and Assumptions
- Bubblewrap is a Linux-only tool; macOS/Windows users see warning + no-op. Assumed acceptable.
- Bubblewrap adds a small spawn overhead (~10-50ms per agent launch). Assumed negligible vs. agent runtime.
- Some agents (Codex) already set `--sandbox danger-full-access` for non-interactive runs; bubblewrap wraps the outer process, not the agent's internal sandbox. These layers compose.
- Bind-mounting the worktree may not cover all agent needs (e.g. temp files, HOME). Initial implementation binds worktree + HOME + /tmp; agents needing more can be extended later.

## Checkpoints
- CP 1: Implement bubblewrap detection module (`src/adapters/process/bubblewrap.ts`) — `isBubblewrapAvailable()` returning cached boolean, warning emitted on first miss
- CP 2: Implement bubblewrap spawn wrapper — function that takes an invocation (command, args, options) and returns a bbwrap-wrapped invocation. Handles worktree bind, readonly root, HOME, /tmp
- CP 3: Integrate into agent launch path — wire bubblewrap wrapper into `spawnAndTee` call site or launcher selection so all families benefit. Add env var `PARALLIX_NO_BUBBLEWRAP` to disable.
- CP 4: Tests — unit tests for detection (available/unavailable), wrapper invocation shape, and integration smoke that spawn-tee contract holds through bubblewrap

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/bubblewrap-detection.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"isBubblewrapAvailable returns true when bbwrap is on PATH"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/bubblewrap-detection.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0029` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Bubblewrap detection module exists | `src/adapters/process/bubblewrap.ts` | PASS |
| Detection test covers available and unavailable paths | `test/bubblewrap-detection.test.ts`, `"isBubblewrapAvailable returns true when bbwrap is on PATH"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `spawn-tee.ts` core piping logic — only add bubblewrap wrapper at invocation level, do not restructure stdout/stderr tee
- Agent family launchers (codex.ts, claude.ts, etc.) — prefer wiring through a shared wrapper rather than editing every launcher file
- No changes to session marker, blocklist, or limit-hit detection logic

## Stop Rules
- Do not add bubblewrap as a project dependency (it is an OS-level binary, not an npm package)
- Do not implement per-agent sandbox policies — one shared policy for all families
- Do not block launch on missing bubblewrap — warning + continue is the contract
- If bubblewrap integration requires restructuring spawn-tee internals, stop and reassess; the wrapper should be a thin layer
