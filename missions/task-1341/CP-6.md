# CP-6

The README opener and quick start now front-load the capability statement, name Git immediately, and show the first usable command path with free-text or directory draft input. Structured markdown task files are documented as optional instead of mandatory.

## Goal Check
| Check | Evidence |
| --- | --- |
| The first actionable example uses `px draft` with free text and `px draft .`. | `README.md:11`, `README.md:13`, `README.md:64` |
| The first 80 lines no longer instruct the user to create a task file before drafting. | `README.md:1` through `README.md:80` |
| Backlog.md task files are now framed as optional. | `README.md:81`, `README.md:83` |
| The opener matches the benchmarked shallow-path structure: capability first, Git named early, command path shown immediately. | `README.md:3`, `README.md:5`, `README.md:13`; `docs/readme-rewrite-benchmark.md:186` |

Next action: run the full suite and the required smoke gates, then write the final checkpoint with the completed evidence table and gate results.
