Mode: portfolio. No execution, no on-disk drafting, no worktree creation.

Goal: propose mission candidates for the user to pick from.

Context to read before proposing anything (and list which files you read):
- `REALITY_PROBE.md` — current state and known drift
- `docs/index.md` — documentation map
- `docs/adr/index.md` — architecture decisions
- `backlog/tasks/` and `backlog/completed/` — queued work plus recent mission history
- `git branch -a | grep mission/` and `git worktree list` — in-flight missions

Output: propose exactly 10 candidate missions. For each, provide:
- Mission (one-line summary)
- Primary leverage (confidence / credibility / promotion signal)
- Primary skill domains (BE / Web / Android / iOS / Ops / Security)
- Estimated scope rank (1–10, 1 = largest)
- Predicted NEL bucket (`n/a` if not ready)
- Selection note (`activate as-is` | `split first` | `defer` | `n/a`)
- Main risk mitigated (skill rot / credibility gap / system weakness)
- Duplicate check: none, or follow-up of <existing mission>
- Status tag: `new` | `follow-up of <existing>` | `already tracked: TASK-NNN` | `already underway: mission/<slug>`

After listing 10:
1. Filter out narrow-skill hygiene work.
2. Cluster survivors by theme.
3. Identify the underrepresented theme using completed-task evidence.

Do not recommend a single mission yet — the user picks.

Graphify-first: if `graphify-out/graph.json` exists, use `graphify query` to understand the codebase architecture and completed-task patterns before proposing mission candidates. This helps identify genuine gaps vs. overlapping proposals.
