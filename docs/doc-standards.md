# Documentation Standard

Rules for writing and editing README.md and subdirectory READMEs in this repository. Derived from `docs/readme-rewrite-benchmark.md` (task-1336) and applied to the current product state.

---

## 1. Headline / Tagline

- The first line after the H1 must be a **one-line capability statement** that tells a skeptical engineer what the tool does.
- Zero internal jargon. Do not use terms like `authority stack`, `state-map`, `adapter internals`, `worktree pattern`, or any abstraction that only makes sense to someone who has read the code.
- Name the audience or the execution context if it matters (e.g., "local-first", "CLI", "for Git operators").
- **Bad:** "Parallix is an authority-driven mission orchestration engine."
- **Good:** "Parallix is a local-first Git workflow CLI for running AI coding agents in isolated, reviewable missions."

## 2. Opening Paragraph

- After the headline, the first paragraph should be **problem-first or contrast-first**: name the pain or define against the adjacent category before describing the mechanism.
- Keep it to 2-4 sentences. Do not lead with features, screenshots, or install commands.
- If the tool has a potentially surprising default behavior, state it early (like Aider stating Git auto-commit behavior, like Cline stating the permission model).

## 3. Quickstart Depth

- Provide a **shallow path to value**: 2-3 commands to a first working result.
- Do not bury the quickstart behind enterprise walkthroughs, multi-provider setups, or configuration steps.
- The quickstart section must be visually separated (fenced code block) and immediately scannable.

## 4. Caveats and Honesty

- Caveats are **trust signals** when stated early and specifically. Alpha status, local-first constraints, limited telemetry, and best-effort guarantees belong in their own visible section ("Current status" or "Limitations").
- Stating limitations upfront builds more credibility than hiding them in fine print.
- Every quantitative claim must travel with its caveats and source references.

## 5. Superlative Prohibition

- No superlatives ("leading", "best", "fastest", "2x faster") without **adoption data or measured benchmarks** to back them.
- If a claim cannot be falsified with a specific number and source, do not use it.
- This is a hard rule for alpha-stage projects with limited measured data.

## 6. "What It Is Not" Section

- Every README must include a section titled **"What \<tool\> is not"** (or equivalent).
- Pre-empt the top 3 objections a skeptical user would have (e.g., "not a model", "not an IDE", "not a magic autonomous engineer").
- This section should appear after use cases and before current status.

## 7. Structural Ordering

The canonical order for this repository's README.md is:

1. H1 title + one-line capability headline (bold)
2. Audience + positioning paragraph
3. **The first concrete thing you can do** (brief intro to quickstart)
4. Quick start (fenced code block, 2-3 commands)
5. Why \<tool\>? (problem-first)
6. What it does (capabilities with evidence refs)
7. The core workflow (diagram or description)
8. Example (realistic human-in-the-loop pass)
9. Use cases (summary with link to full inventory)
10. What \<tool\> is not
11. Current status (alpha caveats, distribution, review surface, versioning, telemetry)
12. Documentation (links to supporting docs)
13. Development (test command)
14. License

Subdirectory READMEs follow a simplified variant: H1 with capability statement, brief description, and relevant sections.

## 8. Tone and Voice

- **Plain, anti-hype, engineer-to-engineer.** Write like an engineer wrote it for engineers, not a marketing team.
- Precise and sober. Casual is fine but do not drift into jokes or bluntness that undermines credibility with a skeptical engineering manager.
- Use active voice. Prefer concrete verbs over abstract nouns.
- When describing capabilities, tie them to evidence: use-case IDs, file paths, test names, or config references.

## 9. Link Hygiene

- All relative links in README.md must resolve to existing files.
- Before editing any README, verify: `docs/use-cases.md`, `docs/authority-reference.md`, `docs/forgejo-setup.md`, `docs/operator-setup.md`, `docs/readme-rewrite-benchmark.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `docs/adr/`.
- Broken links are defects, not acceptable trade-offs.

## 10. Subdirectory READMEs

- `lib/README.md`, `examples/README.md`, and any future subdirectory READMEs must begin with a one-line capability statement (no internal jargon).
- Use consistent heading hierarchy: H1 for the directory name, H2 for sections, H3 for subsections.
- Keep them concise — they are navigation aids, not deep documentation.

---

## Enforcement Hook

These rules are enforced by the hook in `AGENTS.md` under the "Documentation" section. Agents editing any `.md` file in the repo root or `docs/` directory MUST consult this standard before committing changes.
