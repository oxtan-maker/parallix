# Mission: Replace the README first-value commands with a lifecycle video (task-2467)

## Goal
Replace README.md's first-value command block with an accessible, browser-rendered recording that shows a new-directory user create a mission, inspect its drafted contract before execution, run it through autonomous review, inspect the resulting diff, and explicitly integrate it.

## Why Now
The README currently asks readers to infer the lifecycle from three commands. A compact recording can show the human decision points, isolated mission workflow, review, and deliberate integration in one observable first-run path.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a deterministic disposable demo repository, an asciinema source recording, a GitHub-browser-compatible replay, and a focused README replacement.

## Scope
- Create a repeatable terminal-demo setup and asciinema recording for a disposable repository started from a new directory, using a bounded typical task such as a hello-world program.
- Show, in order, mission creation, operator inspection of the drafted mission before `px active`, implementation and autonomous review, operator inspection of the resulting diff, and the operator's `px integrate` decision.
- Render the cast to a GitHub-browser-compatible visual asset with deliberate timing: readable pauses for the mission and diff inspections, accelerated non-observable implementation time.
- Replace only README.md's first-value command block and its adjacent explanatory copy with the accessible embedded replay and concise supporting text.
- Commit the recording source and rendered asset at stable repository paths so the README reference resolves in a clone.

## Out of Scope
- Changes to Parallix lifecycle behavior, agents, review, integration, or CLI commands.
- A hosted video platform, autoplaying HTML video, or analytics.
- A tutorial covering every configuration or Forgejo setup option.
- Replacing the later "Example" workflow section or rewriting unrelated README content.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- README.md replaces the initial fenced `npm install -g @magnusekdahl/parallix` / `px draft` / `px active` / `px integrate` command block with one Markdown image link to the committed rendered replay, whose alt text identifies it as a terminal demonstration and states the lifecycle stages shown.
- The committed asciinema cast starts in a newly created disposable directory and visibly records `px draft`, inspection of the drafted mission before `px active`, `px active` including its autonomous review result, inspection of the mission diff, and an explicit `px integrate` invocation.
- The rendered replay is committed in a format GitHub renders in README Markdown, resolves from the README's relative link, and remains accompanied by its source `.cast` file.
- The replay timing keeps each mission-contract and diff-inspection screen visible long enough to read the command and its primary result, while implementation waiting time is rendered at a faster replay speed.
- README text beside the replay states that the operator inspects the mission before execution and decides whether to integrate after review; it does not claim that Parallix merges autonomously.
- `./scripts/verify-local.sh all` succeeds after the documentation and assets are added.

## Risks and Assumptions
- Assumes `asciinema` and a renderer suitable for GIF or another GitHub-rendered image format are available to the implementer; if unavailable, preserve the cast and stop for a tool decision rather than adding a dependency without approval.
- A real agent run is nondeterministic and can expose credentials or produce long idle periods; the recording must use a disposable repository, sanitized terminal output, and a bounded deterministic demonstration path.
- Binary replay assets can make the diff large; use the smallest rendered asset that remains legible at README width.
- GitHub Markdown image rendering supplies the accessible alternative text; do not introduce raw HTML solely for video playback.

## Checkpoints
- CP 1: Create and validate the disposable demo script or command transcript and record a source `.cast` that shows the required lifecycle and both operator inspection points before changing README.md.
- CP 2: Render the cast with inspection pauses and accelerated implementation waiting, commit the source cast and browser-rendered asset, then replace the README first-value block with an accessible image link and accurate surrounding copy.
- CP 3: Inspect the rendered README reference and asset paths in the final tree, run the repository gate, and record the completed Goal Check with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |` with at least one evidence row per success criterion.
- Evidence for this mission that cites the README path, the committed `.cast` path, the rendered replay path, relevant `px ...` commands captured by the cast, and `./scripts/verify-local.sh all` when run.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `src/`, `test/`, workflow configuration, agent configuration, integration logic, or README sections outside the initial first-value block and its adjacent explanation.
- Do not record credentials, real project data, personal paths, or provider tokens in terminal output or committed assets.
- Do not add a package dependency, a hosted-video integration, or a new runtime feature to produce the demonstration.

## Stop Rules
- Stop and ask for direction if reproducing the required lifecycle needs a real provider credential, changes CLI behavior, or cannot be made deterministic enough to sanitize.
- Stop and ask for direction if no already-available renderer can create a GitHub-rendered replay from the cast without adding a dependency.
- Stop and ask for direction if the smallest legible rendered asset would exceed repository asset-size policy or the README cannot link to it using standard Markdown image syntax.
