# Fresh versus resumed Ornith context: research summary

TASK-2652 replayed six distinct historical Parallix failures in twelve sequential
repair runs. Four cases were newly found and two repeated an earlier pilot with
corrected controls. Earlier invalid or interrupted attempts are excluded.

| Historical failure | Fresh focused check | Resumed focused check | Accepted focused repair |
| --- | --- | --- | --- |
| TASK-2521.01: folded YAML title | Pass | Pass | Both |
| TASK-2535: test selection | Pass | Fail | Neither; fresh left edits uncommitted |
| TASK-2478: TypeScript test contracts | Pass | Pass | Both |
| TASK-2502: checkpoint evidence | Pass | Pass | Neither; authored documentation requirement unmet |
| TASK-2477: source citation | Pass | Pass | Both |
| TASK-2455.01: unavailable UI actions | Pass | Fail | Neither; fresh broke adjacent rendering contracts, resumed timed out |

Fresh passed 6/6 focused checks and resumed passed 4/6. Both produced **3/6
accepted committed focused repairs**. Fresh finished sooner in all six pairs:
median **75.4 seconds versus 305.6 seconds**. It used fewer reported assistant
input tokens in five pairs. Costs include unsuccessful and rejected repairs.
The checkpoint case is distinct from the five code/test cases.

Token usage was captured for every replay, with cached input separate. Totals
below sum the six arms of each kind; repeated context across turns is counted
again. These are reported assistant-request tokens, not unique context sizes or
backend compute measurements.

| Reported tokens | Fresh total | Resumed total | Fresh median/run | Resumed median/run |
| --- | ---: | ---: | ---: | ---: |
| Uncached input | 115,023 | 835,674 | 13,805 | 147,576 |
| Cached input | 4,911,593 | 24,213,930 | 259,386.5 | 3,613,539 |
| Output | 62,913 | 160,359 | 6,187 | 21,092 |

Both arms made 160 tool calls in total. Fresh used fewer uncached input and
output tokens in all six pairs; total cached plus uncached input was lower in
five. Token accounting includes unsuccessful and rejected repairs.

Each starting tracked tree matched its exact historical Git tree hash, including
Parallix source, configuration, scripts and tests. Each original failure was
reproduced three times and its recorded complete historical repair passed.
Scratch repositories had no remotes; none of the twelve replays invoked rebase,
pull, fetch or merge. Both arms received the same diagnostic prompt, model,
logical checkout path, dependency versions, tools, permissions, 600-second budget
and 60-turn cap. Resumed used copied historical context; fresh contained none.

Both received `buildFreshDiagnosticRepairPrompt`. The normal
`buildReboundFixPrompt` instructs the agent to compact before repair; that
instruction was not used for the resumed comparison arm. This isolates retained
history under the same fresh-diagnostic prompt, and does not compare against the
normal compact-first rebound baseline. No new Pi compaction entries were
recorded. llama.cpp internal context processing was not instrumented, and any
compaction-request usage outside final assistant events is not included.
Only one evaluation Ornith run was active at a time while regular missions
continued. Original session hashes matched, and operator state and reference
answers were hidden from the replay namespace.

Historical sessions used AtomicChat/Ornith-1.5-35B-A3B-GGUF:Q4_K_M; replay used
mradermacher/Ornith-1.5-35B-A3B-MTP-GGUF:Q4_K_M and current Pi/Node. Git ancestry
and remote metadata were not restored. Missing remote metadata and copied
executable-wrapper layout prevented green full historical gates. Timing reflects
a shared backend. Cases were selected by recoverable evidence, sampled once per
arm, and inspected manually with arm identities visible.

**Decision:** enough for a bounded engineering case study about context cost and
verification limits. Inconclusive for TASK-2588's failed-first-rebound hypothesis
or a general improvement in repair success. Production recovery policy remains
unchanged. No publication or additional Ornith runs are scheduled.

The full report, charts, harness, tests, datasets, original manifests, final
snapshots and compressed transcripts are archived outside this Git repository in
`../parallix-article-data-task-2652/`. Its `provenance.json` records the baseline
commit and the read aliases for the original evidence paths. The detailed report
is `tools/recovery-context-evaluation/report.md` inside that archive.

Final raw results SHA-256:
`ac133b8357b46e29a526fa9f06477671cb0dcb5e1d7e6813fe4b969d74808235`.
Final manifest SHA-256:
`583067da30d51292b9d4d46d57b21f1f0f1fb6648b02b3d61a97acb7320f4f06`.
