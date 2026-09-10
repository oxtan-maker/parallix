# Mission: README Defence-in-depth section (task-2470)

## Goal
Add one new section to `README.md` that names, in order of the mission lifecycle, the layered defences Parallix runs against agent error — isolation, sandboxing, repository-owned verification, checkpoint evidence validation, gatekeeper artifact checks, separate-agent review with blocked self-approval, failure classification with bounded auto-repair, integration gates, and the operator's final merge decision — so a skeptical reader can see that mission quality comes from tested harness mechanics rather than from trusting the agent's own report.

Every claim in the section must correspond to a mechanism that exists in this repository today, and mechanisms that are best-effort or conditional (Bubblewrap availability, reviewer-family difference, next-wave controls C4/C5 in ADR 0048) must be stated with that limitation attached, per `docs/doc-standards.md` §1 ("which claims are observations, limitations, or guarantees").

## Why Now
The README already sells parallelism ("Why Parallix?", "What it does") but scatters the trust story across unrelated bullets: sandboxing sits in a `What it does` bullet, review separation in another, the verification gate in a third, and the honest limits in `Current status`. A reader evaluating the tool cannot currently answer "what stops a hallucinating agent from landing garbage?" without assembling the answer themselves.

The positioning pivot recorded in `docs/use-cases.md` and the README's own framing — the ceiling is *trustworthy* work in parallel, not typing speed — makes that the central question, not a footnote. ADR 0048 has since inventoried 23 lifecycle check points across 5 phases and marked C1, C2, C3, C6, C7 implemented, so the material for a truthful defence narrative now exists and is stable enough to document.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-file Markdown edit to `README.md`; no source, test, or ADR changes; the bounded risk is claim accuracy and duplication with existing README sections, not implementation complexity

## Scope
- Add exactly one new top-level (`##`) section to `README.md` covering the defence layers in lifecycle order: (1) mission branch + sibling worktree isolation, (2) Bubblewrap process confinement, (3) repository-owned verification gate, (4) checkpoint `Goal Check` evidence validation, (5) gatekeeper mandatory-artifact checks, (6) second preferentially-different reviewing agent with provider-blocked self-approval, (7) failure classification and bounded auto-repair / auto-send-back / human-only dispatch, (8) integration-time gates, (9) operator-owned merge decision.
- State the conditional or best-effort nature of the layers that are conditional: Bubblewrap only when available on Linux (explicit warning otherwise), a *different* reviewer family only when one is runnable, and ADR 0048 C4/C5 as scheduled rather than implemented.
- Link the section to existing durable references already present in the repo: `docs/adr/` (ADR 0048), `docs/use-cases.md`, and `AGENTS.md`, using the README's existing Markdown link style.
- Remove or merge any existing README bullet whose sole purpose is now served by the new section, per `docs/doc-standards.md` §3 ("If two sections have substantially the same purpose, merge them or remove one"), without deleting a differentiator listed in `docs/doc-standards.md` §2.
- Update the `## Documentation` list only if the new section adds a pointer that is not already listed there.

## Out of Scope
- Any change under `src/`, `test/`, `scripts/`, `prompts/`, `config/`, or `workflow.config.json`.
- Creating or editing any ADR, including ADR 0048; the README cites ADRs, it does not restate or amend them.
- Creating a new standalone document such as `docs/defence-in-depth.md`; this mission delivers a README section, not a new doc.
- Implementing, scheduling, or re-classifying ADR 0048 controls C4 and C5.
- Rewriting `README.md` sections unrelated to the defence story (`Example`, `Working with Backlog.md and Forgejo`, `Development`, `License`).
- Benchmark or throughput claims; the existing `+57%` / order-of-magnitude figures stay exactly as they are.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `README.md` contains exactly one new `##` section whose heading contains the string `Defence in depth` (British spelling, matching the task title).
2. That section names all nine defence layers enumerated in Scope: worktree/branch isolation, Bubblewrap confinement, verification gate, checkpoint `Goal Check` evidence validation, gatekeeper mandatory artifacts, second-agent review with blocked self-approval, failure classification / bounded relaunch, integration gates, operator merge decision. Each of the nine is identifiable in the rendered text; a checkpoint table maps each of the nine to the sentence that states it.
3. The section attaches an explicit limitation to each of the three conditional layers: Bubblewrap ("if unavailable, Parallix warns that the agent runs unsandboxed"), reviewer difference ("guaranteed only when another family is runnable"), and ADR 0048 C4/C5 ("scheduled, not implemented"). Absence of any one of the three fails this criterion.
4. Every mechanism claim in the section is traceable to a repository artifact cited in the checkpoint evidence table — one of `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`, `src/adapters/process/bubblewrap.ts`, `src/adapters/verification/gatekeeper.ts`, `src/adapters/review/review-commands.ts`, `src/application/failure-classification.ts`, or `docs/use-cases.md`. No claim in the section lacks such a mapping.
5. No numeric or comparative claim is introduced that does not already appear in `README.md`, `docs/adr/0048-...md`, or `docs/use-cases.md`; the existing `+57%` and "order of magnitude" figures in `## Use cases` are byte-identical to their pre-mission text.
6. Net change is confined to `README.md`: `git diff --name-only <parent>..HEAD -- . ':!missions/'` lists `README.md` and nothing else.
7. Any README bullet removed as redundant is accounted for in the checkpoint document by naming the removed text and the sentence in the new section that now carries it; no differentiator from `docs/doc-standards.md` §2 (parallel work, isolation, agent-agnostic, continuity, separate review and verification, operator control) disappears from the README.
8. `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all` both exit 0 on the final tree.
9. No `file.ext:123`-style line-number reference is introduced into `README.md` (the `docs` area rejects that pattern in `docs/*.md`; keep the README consistent with it).

## Risks and Assumptions
- **Risk: overclaiming.** The temptation is to describe ADR 0048's 23 check points as a guarantee. Mitigation: criterion 3 forces the three conditional caveats; criterion 4 forces per-claim traceability.
- **Risk: README bloat.** `docs/doc-standards.md` §3 explicitly warns against adding a section because a task asked for one. Mitigation: criterion 7 requires redundant bullets to be merged into the new section rather than duplicated beside it.
- **Risk: stale ADR status.** ADR 0048's status table marks C4/C5 as next wave; if that changed since it was written, the README would ship a wrong caveat. Mitigation: the implementer re-reads the ADR status table at CP 1 and records what it says.
- **Assumption:** British "Defence" in the heading is intentional (it is the task title) even though ADR 0048's filename uses American "defense". Both spellings therefore appear in the repo; that is accepted and not a defect to fix.
- **Assumption:** `./scripts/verify-local.sh` runs in this worktree only after `npm install`; a fresh mission worktree has no `node_modules` and the gate dies on missing esbuild until dependencies are installed.
- **Assumption:** The mission touches no code, so `graphify update .` is not required at the end.

## Checkpoints
- **CP 1 — Ground the claims.** Read ADR 0048 (inventory table, failure classification, implementation status), `docs/doc-standards.md` §§1–3, `docs/use-cases.md` positioning boundaries, and the four implementation files named in success criterion 4. Produce in `CP-1.md` a nine-row table mapping each defence layer to its repository evidence and to its limitation (or "unconditional"). No `README.md` edit in this checkpoint.
- **CP 2 — Write the section and dedupe.** Insert the `## Defence in depth` section into `README.md` at the position that reads best given `docs/doc-standards.md` §3 (recommended: after `## The core workflow`, before `## Example`, so the trust story lands before the command walkthrough). Merge or delete any now-redundant existing bullet and record each removal with its replacement sentence. Run `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all`, and record both exit codes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — that exact heading, spelled exactly `## Goal Check`
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion, using durable, verifiable references. Lead with these forms, which Parallix validates today:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh docs` ``, `` `./scripts/verify-local.sh all` ``, `` `git diff --name-only` ``, `` `npm test -- test/documentation-verification.test.ts` ``
  2. **Test names** — must match a real test name in this repo, e.g. a name from `test/documentation-verification.test.ts`
  3. **Test file paths** — e.g., `test/documentation-verification.test.ts` (must exist)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to a file under `docs/adr/`)
  5. **File:line references** — accepted when nothing else fits, but discouraged: line numbers rot on unrelated edits, so prefer a path plus a heading or symbol name
- **Weak-agent failure mode, stated explicitly:** raw `stat` or `ls` output, a bare "verified", or generic prose ("the section is complete", "docs look good") is **not** sufficient evidence on its own. Shell output may appear as supplemental context only when paired with one of the five accepted references above. A row whose entire Evidence cell is prose or a directory listing fails the evidence contract and will bounce back at handoff.
- For this mission specifically: cite the README section by its heading text (`## Defence in depth`) and its subject sentence, not by line number; cite the gate by the backticked command and its exit code.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Section names all nine defence layers | `README.md` heading `## Defence in depth`; nine-row layer/evidence map in `CP-1.md` | PASS |
| Bubblewrap caveat present | `README.md` `## Defence in depth`, sentence beginning "If Bubblewrap is unavailable"; `src/adapters/process/bubblewrap.ts` | PASS |
| Failure classification claim is grounded | `ADR 0048` implementation-status table (C3, C6 marked implemented); `src/application/failure-classification.ts` | PASS |
| Change confined to README | `git diff --name-only` lists `README.md` only | PASS |
| Documentation gate ran | `./scripts/verify-local.sh docs` exit 0 | PASS |
| Full gate ran | `./scripts/verify-local.sh all` exit 0 | PASS |

## Gates
- [ ] `./scripts/verify-local.sh docs`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/`, `test/`, `scripts/`, `prompts/`, `config/`, `workflow.config.json` — read-only for this mission; a diff touching any of them fails success criterion 6.
- `docs/adr/**` — read-only. Cite ADR 0048, do not edit or supersede it.
- `docs/use-cases.md`, `docs/doc-standards.md` — read-only inputs.
- `README.md` sections `## Example`, `## Working with Backlog.md and Forgejo`, `## Development`, `## License` — do not restructure; the `## Use cases` numbers must stay byte-identical.
- `backlog/tasks/task-2470 - Update-the-README-with-a-Defence-in-depth-section.md` — do not delete, rename, or move; do not edit `assignee`.

## Stop Rules
- Stop and report if ADR 0048's implementation-status table contradicts a caveat this mission requires (for example, if C4/C5 are now marked implemented). Do not silently reword the caveat and continue — record the discrepancy and the chosen wording in `CP-1.md`.
- Stop if writing an accurate defence claim would require a code change to make it true. The README documents what exists; it does not get changed to match the code, and the code does not get changed to match the README.
- Stop if `./scripts/verify-local.sh all` fails for a reason unrelated to `README.md`. Do not repair unrelated source or tests under this mission; report the failing check and the fact that the mission diff is README-only.
- Stop if the new section exceeds roughly 45 lines of `README.md`. That is the signal that the material belongs in a standalone doc, which is out of scope, and needs an operator decision.
- Stop if deduplication would remove a differentiator listed in `docs/doc-standards.md` §2; leave the bullet in place and note the overlap instead.
