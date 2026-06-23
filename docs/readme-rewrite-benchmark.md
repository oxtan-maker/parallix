# README rewrite benchmark — how credible developer-tool READMEs open

**Purpose:** Establish what a skeptical engineer expects to see in the first screen of
a developer-tool README, so the Parallix rewrite (task-1336) borrows proven structure
without copying the hype patterns that would undercut its credibility.

**Method:** Seven comparable projects were inspected — AI coding agents, agent
frameworks, and CLI developer tools that compete for the same first-glance attention
Parallix needs to win. For each: opening headline/tagline pattern, first-paragraph
structure, what the README leads with (features / problem / example / screenshot /
install / docs), quickstart depth, how credibility and caveats are handled, what is
worth borrowing, and what should *not* be copied because it would make Parallix less
credible.

The benchmark is descriptive of the prevailing patterns these projects use; it is not a
line-by-line transcription. The decisions column is the actionable output.

---

## 1. Aider (`Aider-AI/aider`)

- **Headline/tagline:** "Aider is AI pair programming in your terminal." A one-line
  capability statement, no adjectives.
- **First paragraph:** What it is + the concrete loop it runs ("edit code in your local
  git repo … works with your existing files"). Names Git as a first-class concept
  immediately.
- **Leads with:** Capability statement, then a short feature list, then install. A
  recorded terminal cast (asciinema) sits near the top.
- **Quickstart depth:** Very shallow path to value — `pip install aider-install` →
  `aider --model …` → start editing. Two or three commands to a working session.
- **Credibility/caveats:** Strong proof signal — leaderboard/benchmark numbers (SWE-style
  edit benchmarks), explicit "works best with" model guidance, and an honest note that
  results vary by model. Git auto-commit behavior is stated up front so it is not a
  surprise.
- **Borrow:** The one-line capability headline; naming Git as a first-class concept in the
  first paragraph; a shallow two-to-three-command path to a first result; stating a
  potentially surprising default behavior up front.
- **Avoid:** Leading the page with benchmark leaderboards — Parallix has *one* measured
  figure with heavy caveats (`docs/use-cases.md` UC-1), not a maintained benchmark, so a
  leaderboard-style flex would over-claim. Keep the measurement, drop the leaderboard
  framing.

## 2. Goose (`block/goose`)

- **Headline/tagline:** Positions as "an open-source, extensible AI agent that goes beyond
  code suggestions" — it frames against the *limitation of the adjacent category*
  (autocomplete/suggestions) rather than listing its own features first.
- **First paragraph:** What it is + who builds it (Block) + the differentiator (executes
  tasks, not just suggests). Establishes credibility by association and by contrast.
- **Leads with:** Problem/positioning contrast, then capabilities, then install. Polished
  but still text-first above the fold.
- **Quickstart depth:** Medium — a CLI install plus a desktop option; a few steps to a
  running agent, with provider/key setup called out.
- **Credibility/caveats:** Corporate backing is the main trust signal; extension/MCP
  ecosystem implies durability. Lighter on hard limitation statements.
- **Borrow:** Positioning *against the adjacent category* ("goes beyond suggestions") is
  exactly the move Parallix needs — define against "a single coding agent run directly,"
  not against nothing. Naming who is behind it builds trust.
- **Avoid:** Leaning on corporate backing as the trust signal (Parallix is a solo,
  alpha, local-first project — claiming institutional weight would be dishonest). Replace
  that trust signal with cited code/tests and stated caveats instead.

## 3. OpenCode (`opencode-ai/opencode` / sst)

- **Headline/tagline:** "The AI coding agent built for the terminal." A
  built-for-*audience* tagline — it names the user (terminal-native developers) inside the
  tagline itself.
- **First paragraph:** Short — what it is and the audience, then straight to a visual and
  install. Provider-agnostic ("works with any model") is stated early as a differentiator.
- **Leads with:** Tagline → screenshot/TUI image → install. Heavily visual above the fold.
- **Quickstart depth:** Shallow — a single curl/npm install line and a run command.
- **Credibility/caveats:** Provider-agnosticism and a clean TUI are the implicit proof;
  caveats are light.
- **Borrow:** Naming the audience inside the positioning ("for operators comfortable with
  Git and CLI"); stating provider-agnosticism (Parallix's multi-family support is a
  genuine parallel — codex/claude/mistral/qwen).
- **Avoid:** The screenshot-first above-the-fold — Parallix's mission is explicitly *out
  of scope* for screenshots/demos (task-1336 Out of Scope), and a CLI workflow harness is
  better shown by a command-flow block than a TUI image. Lead with text and a fenced
  command example instead.

## 4. Get Shit Done — `gsd` (agentic CLI task runner)

- **Headline/tagline:** Blunt, outcome-named tagline (the tool name *is* the promise).
  Plain-spoken, anti-hype voice.
- **First paragraph:** States the pain ("you keep re-explaining context to your agent")
  before the solution. Problem-first.
- **Leads with:** Problem statement → the workflow it imposes (structured tasks/plans) →
  install.
- **Quickstart depth:** Shallow-to-medium; an install line and a first command that
  produces a plan/task artifact.
- **Credibility/caveats:** Plain voice itself is the credibility signal — it reads like an
  engineer wrote it for engineers, not a marketing team. Limitations stated casually but
  honestly.
- **Borrow:** Problem-first opening (state the pain before the mechanism); the structured
  workflow framing (tasks/plans as durable artifacts) is the closest analog to Parallix
  missions/checkpoints; the plain anti-hype engineer voice is the exact tone target.
- **Avoid:** Over-casual voice that drifts into jokes — Parallix's audience is a
  *skeptical engineering manager*, so keep the plain voice but stay precise and sober.

## 5. Continue (`continuedev/continue`)

- **Headline/tagline:** "the leading open-source AI code assistant" — a category-leadership
  claim plus what it is.
- **First paragraph:** What it is + where it runs (IDE extensions) + extensibility. Names
  the integration surface immediately.
- **Leads with:** Capability + ecosystem, screenshots/GIFs of the IDE experience, then
  install per-IDE.
- **Quickstart depth:** Medium — install the extension, configure a model, use it; more
  setup than a pure CLI.
- **Credibility/caveats:** Open-source + large ecosystem as trust; a "leading" superlative
  that only works because adoption backs it.
- **Borrow:** Naming the integration surface early (for Parallix: Git worktrees + your
  existing CI gate, not an IDE).
- **Avoid:** The "leading" superlative — Parallix is alpha with one measured window; any
  leadership/superlative claim fails the falsifiability bar (task-1336 Success Criteria,
  ADR 039 Part 2). Also avoid IDE-centric framing: Parallix is explicitly *not* an IDE
  (it is a CLI workflow harness), and the "What Parallix is not" section must say so.

## 6. Codex CLI (`openai/codex`)

- **Headline/tagline:** "a coding agent that runs locally on your computer." Local-first
  capability statement.
- **First paragraph:** What it is + local execution + a one-line install. Emphasizes
  running in your terminal against your repo.
- **Leads with:** Capability → install → a short usage example. Sandbox/approval behavior
  is documented near the top because it affects trust.
- **Quickstart depth:** Shallow — one install command, one run command.
- **Credibility/caveats:** Documents sandboxing and approval modes early — security posture
  *is* the caveat handling. Honest about what it will and won't touch.
- **Borrow:** Local-first stated as a feature, not an apology ("local-first developer
  workflow"); documenting safety/boundary behavior (for Parallix: review gate, verification
  gates, what it will not auto-merge) as a trust signal rather than fine print.
- **Avoid:** Nothing major to avoid; the trap here is matching its polish/scope claims —
  Parallix should not imply a comparable maturity. State alpha status plainly.

## 7. Cline (`cline/cline`)

- **Headline/tagline:** Capability + autonomy framing ("can use your CLI and editor"),
  with explicit human-in-the-loop language ("with your permission").
- **First paragraph:** What it does + the explicit approval model. Autonomy is paired with
  a control statement in the same breath.
- **Leads with:** Capability → permission/approval model → screenshots → install.
- **Quickstart depth:** Shallow (marketplace install).
- **Credibility/caveats:** The *headline pairing* of "autonomous" with "with your
  permission" is the credibility move — it pre-empts the "is this a runaway agent?"
  objection in the first sentence.
- **Borrow:** Pairing capability with a control statement up front — Parallix should pair
  "runs multiple agents" with "behind a forced review step and your own verification
  gates" so the autonomy fear is answered immediately. This directly informs the "What
  Parallix is not … not a magic autonomous engineer" section.
- **Avoid:** Marketplace/IDE-install framing (not applicable to a CLI harness).

---

## Cross-cutting findings

1. **Every credible README states what the tool *is* in one line, in the first sentence,
   with zero internal jargon.** None of the seven opens with its own internal
   abstractions. → Parallix must not open with "authority stack / state-map / adapter
   internals."
2. **The strongest openers are problem-first or contrast-first** (Goose, gsd, Cline) — they
   define against the adjacent category or name the pain before the mechanism. → Parallix
   leads with "running several AI coding agents directly against one repo clobbers the
   working tree" before describing missions/worktrees.
3. **Shallow quickstart wins.** Two-to-three commands to a first result is the norm. →
   Parallix's Quick start must be a short, honest path: `npm pack` + global install + a
   first mission command, no enterprise walkthrough.
4. **Caveats build trust when stated early and specifically** (Aider benchmarks + "varies
   by model", Codex sandbox, Cline permission). → Parallix turns its *honesty* into the
   trust signal: alpha, local-first, npm-pack-only, one measured window that eroded, review
   coverage caveats — all cited.
5. **Superlatives and leaderboards only work with adoption/benchmarks behind them**
   (Continue "leading", Aider leaderboard). Parallix has neither at scale → no
   superlatives, no "2× forever"; use the single cited figure *with* its caveats.

## Structure decision

The task-1336-specified structure (positioning line → Why Parallix? → What it does → The
core workflow → Quick start → Example → Use cases → What Parallix is not → Current status →
Documentation → Development → License) **matches the prevailing credible pattern** and is
adopted as-is. It is problem-first (Why Parallix? early, per finding 2), keeps the
quickstart shallow and high (finding 3), and dedicates explicit sections to caveats ("What
Parallix is not", "Current status") per finding 4. No competitor revealed a clearly
superior structure that would justify deviating, so **no stop-rule escalation is
triggered**. The one adaptation from the benchmark: lead the page with a fenced
command-flow / example block rather than a screenshot (findings re OpenCode/Continue),
since screenshots are out of scope and a CLI harness is better shown as commands.
