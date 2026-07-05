# CP-3: Rename template file and update headings

## Work Done

1. Renamed `templates/MISTRAL.md.template` → `templates/VIBE.md.template`
2. Updated heading: `# Mistral / Vibe — {{PROJECT}}` → `# Vibe — {{PROJECT}}` (line 1)
3. Updated: `This is the Mistral-specific adapter` → `This is the Vibe-specific adapter` (line 3)
4. Updated section: `## Mistral-specific runtime rules` → `## Vibe-specific runtime rules` (line 7)
5. Updated section: `## Mistral mode mapping` → `## Vibe mode mapping` (line 14)
6. Left `## Vibe command surface` section body unchanged (already uses "Vibe")

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `templates/VIBE.md.template` exists | File present at `templates/VIBE.md.template` |
| 2 | Old `MISTRAL.md.template` absent | No file at `templates/MISTRAL.md.template` |
| 3 | Title heading updated | `templates/VIBE.md.template:1` → `# Vibe — {{PROJECT}}` |
| 4 | Intro sentence updated | `templates/VIBE.md.template:3` → `This is the Vibe-specific adapter.` |
| 5 | Runtime rules heading updated | `templates/VIBE.md.template:7` → `## Vibe-specific runtime rules` |
| 6 | Mode mapping heading updated | `templates/VIBE.md.template:14` → `## Vibe mode mapping` |
| 7 | Command surface section unchanged | `templates/VIBE.md.template:20` → `## Vibe command surface` |

## Next action
Execute CP-4: Run `./scripts/verify-local.sh all` to verify static analysis and tests pass on the final tree.
