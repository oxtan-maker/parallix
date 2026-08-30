# CP 1 — Red reproduction test

Added the focused sandbox-argv reproduction. It pins `HOME` and `CODEX_HOME`, creates a temporary Git worktree, and proves that the four non-review families lack their required writable state binds on the mission-parent behavior. The narrowness assertion is already green.

Pre-fix argv capture from `npm exec -- tsx -e "…buildBubblewrapArgs(resolveSandboxProfile('active', worktree, null, family), worktree)…"` using worktree `/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y`:

```text
claude: ["--ro-bind","/","/","--dev","/dev","--proc","/proc","--die-with-parent","--bind","/tmp","/tmp","--bind","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--chdir","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--"]
codex: ["--ro-bind","/","/","--dev","/dev","--proc","/proc","--die-with-parent","--bind","/tmp","/tmp","--bind","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--chdir","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--"]
opencode: ["--ro-bind","/","/","--dev","/dev","--proc","/proc","--die-with-parent","--bind","/tmp","/tmp","--bind","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--chdir","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--"]
pi: ["--ro-bind","/","/","--dev","/dev","--proc","/proc","--die-with-parent","--bind","/tmp","/tmp","--bind","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--chdir","/home/magnus/code/parallix-task-2443/.workflow/task-2443-argv-bNm91Y","--"]
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red per-family non-review writable-bind reproduction | `test/task-2443-repro.test.ts`, `"task-2443: active claude argv binds credentials, session env, and project state"`, `"task-2443: active codex argv binds the configured host auth file"`, `"task-2443: active opencode argv binds only opencode state homes"`, `"task-2443: active pi argv binds only pi state homes"` | RED — four assertions fail at mission parent |
| SC4 narrowness is retained by the reproduction | `test/task-2443-repro.test.ts`, `"task-2443: active profiles do not cross-bind families or grant qwen/vibe host homes"` | PASS |
| SC7 records a bug-first reproduction | `npm test -- --unit-test-headroom test/task-2443-repro.test.ts` | PASS — 4 failing family assertions, 1 passing narrowness assertion |

Next action: add the shared per-family state-home resolver and make the red argv assertions green without widening any bind.
