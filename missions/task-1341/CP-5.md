# CP-5

The remaining hardcoded task-path and Backlog.md assumptions were moved behind adapter-backed helpers or rewritten as optional markdown-task language. Task storage now supports `storagePath`, backlog resolution uses adapter paths, and hardcoded `backlog_task_create` guidance is gone.

## Goal Check
| Check | Evidence |
| --- | --- |
| Task storage now exposes adapter-driven active/completed/archive directories and `storagePath`. | `lib/core/product-config.js:368`, `lib/core/product-config.js:378` |
| Backlog resolution and manual repair guidance now use adapter-backed task paths. | `lib/tools/backlog.js:12`, `lib/tools/backlog.js:16`, `lib/tools/backlog.js:123` |
| Setup copy now describes the default layout as optional markdown task storage rather than a Backlog.md requirement. | `lib/tools/setup-review.js:91`, `lib/tools/setup-review.js:614` |
| `lib/` no longer contains hardcoded `backlog/tasks`, `backlog/completed`, `backlog/archive`, `Backlog.md`, or `backlog_task_create` references. | `rg -n "backlog/tasks/|backlog/completed/|backlog/archive/|Backlog\\.md|backlog_task_create" lib` returned no matches |

Next action: finish the documentation rewrite so the first-time operator path starts with install plus `px draft "hello world"` instead of a manual task-file detour.
