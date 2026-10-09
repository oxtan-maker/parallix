---
id: TASK-2692
title: >-
  Evaluate structured gate-failure evidence for Jev repair reviews and implement
  if useful
status: done
assignee: [codex]
created_date: '2026-10-08 15:03'
labels:
  - ai_sdlc
dependencies:
  - TASK-2691
references:
  - /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/analysis.json
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/context-packets.json
  - src/application/integrate/gates.ts
  - src/application/review-classification/classify-review.ts
  - docs/adr/0065-local-review-classification-evidence.md
  - >-
    /mnt/data/code/parallix-artice-data/jev-live-audit-2026-10-08/prior-research-map.json
priority: high
ordinal: 196008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evaluate retained gate-failure evidence and implement the successful gate-repair re-review tuning, complete repair-diff packing and adapter-owned Jev token budgeting through the TypeScript jevtok-ts library. Preserve the original negative capture experiment and historical-review comparison limits.

Trace gate output through capture, durable failure cause and classifier packets; audit October 6-8 external evidence; prototype bounded mechanical diagnostics and pinned repair evidence; compare capture-only, repair-source-only and combined paired arms against tail-only; validate fresh independent families and externally retain every arm. Conditionally implement the validated rule through existing approved boundaries with owning tests/docs. Search retained research and raw outputs from previous Missions and sibling /mnt/data/code/parallix-artice-data (including task-2650 and task-2658), plus matching parallix-article* directories, before declaring historical evidence unavailable. Keep large research artifacts outside this repository; distinguish archived original outputs from reconstructed packets and later outcomes. Operator research priority: test the hypothesis that the existing final 4000-character failure tail is sufficient when paired with the actual repair diff, relevant pinned code context and the failure that caused the bounce. Prioritize tail-plus-repair-source against the current packet; treat structured/full-output capture as a separate incremental comparison, not an assumed prerequisite or presumed cause. Preserve negative results and measure whether richer capture adds value beyond repair context. Read /home/magnus/.local/state/parallix/research/task-2692/operator-research-leads.json for additional retained gate records and prototype-review points before freezing validation; provide substantive focused before/after repair excerpts plus relevant code context when whole files exceed budget, with attribution uncertainty and omissions visible. Protocol constraints must follow mission criteria: no arbitrary prospective-only or minimum-25-family blocker. Before calls, read operator-research-leads.json protocolReview; use genuine independent held-out gate-repair families not used to develop this algorithm, disclose prior-experiment overlap, independently adjudicate before calls and report sample limitations. Preserve superseded zero-call protocols when correcting them. Operator follow-up: validate model-specific token prediction against retained usage, fix the external research packer to enforce final provider-byte and token budgets with explicit context alignment/omissions, freeze the revised packets before new calls, and rerun every previously provider-rejected or locally size-failed sample through packing and actual Jev calls. Retain preparation, alignment, requests, errors, usage and combined dataset with original and revised provenance separate. Finish active deliverables only; operator starts review afterwards. Operator-approved October 9 implementation follow-up: adopt the frozen refined repair prompt and exact-revision pre-review facts only at their recorded scope; tune gate-failure repair returns to 67%, rising to 81% after a Jev decision, with clear remaining 52%. Historical general-review decisions are the comparator, not absolute correctness labels. Retain all prompt/validation results and threshold-selection limitations; extend owning suites and run isolated live end-to-end verification. Original capture/packing non-adoption remains historical and unchanged. Production completion: retain the complete repair diff as mandatory evidence; prioritize pinned source pairs and truthfully labelled candidate-only/omitted context using adapter-owned token and byte budgets. Use jevtok-ts 0.2.0 in the self-contained bundle, reject unsupported or oversized repair requests to general review, and verify token predictions, replayed samples, owning contracts, packaging and isolated live lifecycle. The operator accepted the typed DecisionPort budget proposal with the instruction to use an existing TypeScript tokenizer library; preserve application/provider dependency direction.


<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A retained loss audit traces full process output, the 4000-character durable tail and classifier input for the October 6-8 gate-repair cohort, identifies incidental paths and irrecoverable diagnostics, separates recoverable output from unavailable history, and distinguishes gate repairs from original-finding resolution and new findings.
- [x] #2 Before validation calls, archive a frozen protocol specifying sample selection, exclusions, model, byte cap, independent labels, randomized paired-call order, repeats and adoption bar for tail-only, capture-only, repair-source-only and combined arms. Retain controls for diagnostics outside the tail, coverage noise, multiple failures, stream ordering, unfamiliar formats and absent diagnostics; cluster repeated rounds/calls by mission and separate development controls from fresh families.
- [x] #3 Bounded prototype records copy real command/exit/revision, failed cases, diagnostic/assertion blocks, frames, tail/raw fallback, provenance and dropped blocks; prefer available TAP/JUnit/compiler/checker diagnostics. Include pinned repair manifest and before/after source; mark actual implementer explanations unverified and admit verification only from existing revision-bound authority. Resource/harness keywords grant no flake exemption or gate clearance.
- [x] #4 Fresh independently adjudicated mission families report paired correct routes, false clears/returns, abstentions and uncertainty separately for assertion, coverage/quality, static-analysis, resource and harness failures. Keep unavailable/larger inputs in the denominator and archive every arm and negative result externally. Separately measure preparation, bytes/tokens, API cost, fallback work, selected routes and applied verdicts; do not derive a low error bound from zero errors in a small sample.
- [x] #5 If adopted, extend existing owning suites at ADR 0057 tiers, run focused contracts and static analysis, preserve finite CPU budgets and file caps, and manually exercise the real classifier route in an isolated end-to-end fixture without real statistics writes. Update live docs and run docs verification for changed behavior. Final Goal Check rows cite actual retained file:line evidence and test names for every criterion; final verification passes without focused or unannotated skipped tests.
- [x] #6 Implement complete gate-repair diffs with pinned context and explicit omissions, adapter-owned token/byte budgets using jevtok-ts, safe oversized/unsupported fallback and self-contained packaging. Apply 52% clear/67% return only to tuned repairs, or 81% after prior Jev; preserve other policies and authority. Retain the original negative experiment and historical-comparison limits. Verify owning tests, replay token parity, packaging, static/docs checks and isolated live lifecycle; operator starts review.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Retained research evidence

Research archive: `/home/magnus/.local/state/parallix/research/task-2692/`.
The supplied `/mnt/data/code/parallix-artice-data/` archive is read-only;
new research is retained outside the repository in the writable state directory.
No files are written under `missions/`.

The reproducible `audit.py` reads the October 6–8 snapshot and pinned Git
objects without writing operator data. `loss-audit.json` retains source hashes,
39 individual gate-repair rows, their tails, source availability, packet
selections, omissions and historical capture-source line references. Of 69
snapshot rounds, 39 are gate repairs across 22 missions, 29 address original
findings, and one has no findings. Gate repairs all selected the reviewer.
35 tails saturate the 4,000-character bound; seven reconstructed packets have
no selected source; median packet size is 34,178 bytes. Eight packets select
runner/coverage paths. Selected unchanged paths are incidental-path candidates,
not proof of irrelevance: they may be dependencies.

Capture trace: `src/adapters/config/repository-gates.ts:458` retains separate
stdout/stderr through `src/adapters/config/gate-dashboard.ts:6` (currently
1,048,576 characters per stream). `src/application/integrate/gates.ts:100`
joins stdout then stderr, trims and keeps the final 4,000 characters in the
rebound cause. `src/application/review-classification/classify-review.ts:98`
uses that cause and a fixed verification sentence, gated by the verified
candidate revision. `src/application/review-classification/evidence-packet.ts:132`
selects cited paths and degrades complete files to windows/fallback; it does
not supply the complete repair manifest. The optional durable sink in
`src/adapters/process/spawn-tee.ts:232` belongs to agent launches and does not
retain gate-runner output automatically. Historical source matches are retained
per row rather than assuming today's source was deployed for every round.

The broad archive search (`archive-search.json`) hashed and searched 8,688
readable text/JSON/gzip files, including task-2650 and task-2658. The only
cohort-name matches outside the snapshot were task-2651 in an earlier bug audit,
not its October gate output. No matching parallix-article* directory was found
at /mnt/data/code, /mnt/data or /home/magnus. This bounds the unavailability
claim to attributed retained evidence rather than every anonymous host log.

The supplied archive has no attributed original full gate transcripts or historical
provider requests; all 22 searched worktree recovery directories are absent.
The surviving tails are recoverable. Prefix diagnostics and original stream
ordering are unavailable, with no reconstruction from later source or answers.
Command and exit status are absent from these snapshot inputs. All pinned
source revisions are readable. Earlier reviewer events concern earlier
revisions: they cannot adjudicate gate repairs, original-finding resolution,
or new findings at the candidate. No actual implementer explanation or
independent gate-repair label is supplied. Historical Jev predictions are not
independent labels; reconstructed packets are not exact request replays.

Existing capture/packet ownership is retained in
`test/integration/verification/repository-gates.test.ts` (including
“parallel unit gate retains failed assertions after a passing group for repair
prompts (TASK-2637.03)”),
`test/unit/application/review-classification/evidence-packet.test.ts`
(including “packet retains actual review and response with complete cited files
at pinned revisions”), and
`test/unit/adapters/cli/commands/integrate-gate-rebound-and-repair-contract.test.ts`.
ADR 0057 governs any conditional implementation tests. Research does not change
production ports, composition, adapters, routing thresholds or publication.

### Frozen capture and packing experiment

`protocol.json` was frozen before validation calls, SHA-256
`3142cfabf042a2873042d30d471eb5e64903fdd96bfedbf8bc384266a273adef`.
Its primary contrast is tail plus pinned repair source versus the current
packet; combined capture is an incremental comparison against source-only.
The four arms preserve the failure obligation and 52%/89% routing policy.
The protocol fixes OpenRouter `jev-latest` (an alias; returned model drift must
be reported), a 90,000-byte provider-body cap, three repeats, seeded randomized
paired order, independent labels kept outside requests, mission-family
clustering, explicit unavailable-input denominators, five failure strata and
a prospective five-family-per-stratum intake rule. Adoption requires positive
paired correct-route gain, no new observed false clears/returns or safety
regressions, and measured net workflow benefit including preparation/API/fallback
work. Unknown costs cannot establish benefit; zero errors in a small sample
cannot establish a low error bound.

`prototype.py` copies actual command, exit/signal, pinned revision, observed
stream-order metadata, failed TAP/JUnit cases, diagnostic blocks and frames,
stream hashes, tails and bounded raw fallback. Dropped blocks carry source
ranges and hashes; counts/hashes identify metadata omitted under the bound.
The original raw run is retained separately. Capture records are capped at
16,000 bytes. The repair manifest reads only the two pinned Git revisions and
includes all changed paths, before/after whole-source hashes, bounded copied
source and the actual diff, with explicit omissions. The corrected prototype
retains actual changed-hunk/module-context excerpts when whole source exceeds
budget, including exact line ranges, side hashes and omitted ranges. A large
source control verifies substantive before/after behavior beyond line 1,000. Approved-to-candidate
ranges may contain rebased main content; they are not falsely presented as a
narrow implementer-only repair. No existing verification authority was supplied,
so the prototype makes no passed-verification claim. Implementer explanations
are absent; any supplied explanation remains unverified.

`development.py` manually exercised 11 isolated real-process controls with
finite child deadlines and cleanup: TAP failures outside a tail followed by
coverage noise, multiple TAP failures, 80 failures with dropped-block pressure,
real JUnit reporter output, stderr-before-stdout ordering, an actual threshold
checker, actual TypeScript compiler errors, unfamiliar/absent diagnostics,
a 16 MiB Node heap exhaustion with core dumps disabled, and a killed harness
child. The extractor's copied blocks match exact raw line spans and hashes;
all four arms satisfy the packing bound. Resource/harness text provides no
flake exemption or clearance. Results and all 44 development arms are external
in `development-results.json` and `dev-*.json`. A development cap regression
from unbounded chunk-order metadata was found, fixed and retained in
`development-failures.json`; all 11 controls pass after the fix. Largest capture
record: 9,380 bytes. These are development contract checks, not fresh operational
classifier validation or repository unit suites.

`prepare.py` retains all 156 arms for the 39 historical gate-repair rows,
including missing full capture, source omissions, and five source-only packets after the focused-excerpt correction
that degrade to an explicit unavailable fallback under the cap. Those rows are
descriptive preparation, not fresh validation. Preparation times and bytes are
separate in `historical-preparation.json`; provider tokens, selected routes and
fallback work remain unmeasured, API calls/cost and applied verdicts are zero.
The model route is available through the existing composition after loading
the operator Bash environment; no credentials are retained in artifacts.

### Corrected protocol and held-out adjudication

The zero-call v1 protocol is preserved as
`protocol-v1-superseded-zero-calls.json`. Its prospective-only and minimum
25-family constraints were implementation choices, not mission requirements;
they were removed after operator review before any classifier call. The large
source omission rule was corrected at the same pre-call boundary. No outcome
was used to tune the prototype.

The corrected `protocol-v2.json` SHA-256 is
`d3c36ced0262f4636ee23b970bc2164dbb46d859694cd3625bee10cef77081c0`.
`heldout-manifest.json` SHA-256 is
`07c825a7b12855b516a921d4e4015532773156b99ecc0181598d35375ffdad77`.
Ten retained gate-repair families are sealed, held out from this algorithm's
development, across provisional assertion, quality, static-analysis, resource
and harness strata. The manifest discloses prior task-2650/task-2658 experiment
mentions/exclusions and overlap uncertainty. Each family's failed gate and
next recorded review subject are pinned before source inspection or Jev calls;
no model-answer-based additions or replacements are permitted. Missing/larger
inputs stay in the denominator. No arbitrary sample minimum blocks evaluation;
ten families cannot establish a low error bound.

`heldout-label-blind-review.json` supplies the original failure and pinned source
artifacts for independent operator-root adjudication, separate from this
prototype author. It contains no Jev responses, later reviewer answers or
later repairs. Every label must name the actual gate-repair obligation, exact
candidate revision, evidence and adjudicator identity; unknown and attribution
uncertainty are allowed, and original findings/new findings are separate.
`independent-labels.template.json` gives the expected label-side structure.
Prior whole-PR approvals alone are not labels. Retained candidate-review subject
differences are in `independent-evidence-inventory.json`, outside packet inputs.

`prepare-baselines.mts` uses the actual current production evidence builder,
Git evidence adapter and decision-port byte measurement. `prepare-requests.py`
retains all 40 held-out arm payloads; the v2 protocol seals their hashes before
calls. Missing full transcripts do not block the primary tail-plus-source
contrast; capture arms explicitly declare unavailable original output, which
cannot validate the incremental value of actual richer capture.
`evaluate.mts` refuses calls without separate independent labels matching the
sealed manifest, verifies code/payload hashes, uses the existing decision-port
composition and unchanged 52%/89% selector, randomizes the three paired repeats,
and retains requests, responses/errors, actual provider-body bytes, returned
model, usage, time and selected routes. Applied verdicts/statistics/Forgejo
writes remain zero. `summarize.py` reports per-stratum routes, false clears and
returns, abstentions, unavailable/unknown counts, clustered paired differences,
uncertainty and separate costs. Unknown fallback work cannot prove net benefit.

### Frozen validation result and negative decision

Independent primary-root-codex adjudication preceded every Jev call and is
retained in `independent-labels.json`: one addresses, one does-not-address,
and eight insufficient-evidence labels. Confirmed strata contain two assertion,
two quality, one static-analysis, three resource and two harness families.
The 120 randomized paired evaluation rows (ten families × four arms × three repeats)
all retained the reviewer route: 108 reached the provider, yielding 87 model
responses and 21 rejections; 12 used local size-limit fallbacks. Every arm has zero correct useful autonomous
routes, 24 correct required-abstention calls and six unresolved actionable
obligations across repeats; zero false clears and returns were observed.
Repeated calls are clustered by ten families, not counted as 120 independent
examples. Eight insufficient-evidence families make this sample conservative
and limit its ability to detect autonomous-route gains. A zero-width empirical
bootstrap resample of zero observed gains is not a population error/gain bound.

`paired-results.json` retains every request hash, response/error, usage, actual
provider-body byte count, preparation and API time. Tail-only/capture-only
had zero provider failures; source-only had nine and combined twelve provider
rejections, retained as reviewer fallbacks rather than dropped cases. The
returned model was `typesafe/jev-1.13-20260917` throughout. Reported usage
across 87 rows sums to 1,291,200 input tokens and $0.0542304; 33 rows have no
usage, so this is partial reported cost, not complete total. Recorded classification elapsed time
sums to about 40.25 seconds for all arms/repeats, including local size checks. Median actual provider-body
sizes: baseline 40,818.5 bytes, capture-only 40,906.5, source-only 83,041,
combined 79,049. Preparation is retained separately per family/arm, with no
cold-cache claim.

Ordinary review remains required for every selected route, with zero avoided
review routes and zero applied verdicts. `fallback-measurements.json` records
ten exact-subject historical ordinary-review intervals totaling 523,202 ms.
They include whole-PR work/waits and are not a matched gate-only counterfactual
cost. Matched fallback work remains unknown, not zero; no net workflow benefit
is established. Full original capture is unavailable for the held-out sample,
so missing-capture arms do not establish the incremental value of real richer
capture. No claim is made that all tail-plus-source rules fail.

The frozen adoption bar fails: no paired useful-route gain, added provider
failures and preparation/classification burden, and no demonstrated net benefit.
No production rule, thresholds, review authority, statistics, publication,
adapter boundary or live product documentation changes are adopted. Negative
results and superseded zero-call protocols remain external. The concise
committable artifact is `backlog/docs/task-2692-research-summary.json`, carrying
measured results, limitations and external artifact hashes; `evaluation-summary.json`
and `artifact-ledger.json` retain the complete external measurement/index.

Final focused verification: the existing packet suite passes 11/11 with zero
skips, including fixed-threshold and known safety-failure assertions; the same
focused suite passes unit headroom. Static analysis passes all four stages,
docs verification passes, and frozen code/payload/label/retained artifact hashes
verify. No executable tests were added or changed and no focused/unannotated
skips introduced. The real classifier route was manually exercised through 108 API attempts
on pinned research inputs with zero operational writes. `git ls-files missions/` is empty.
No user-facing behavior was changed, so no live product documentation update
is needed. Parallix handoff owns the declared full gate; the execute agent
does not claim that focused verification ran that gate.

A separate operator-requested diagnostic replay, excluded from all frozen
counts and tuning, confirmed HTTP 400 `max_tokens_exceeded` for one rejected
84,878-byte source-only request. Byte caps do not establish token-limit
compliance. The provider diagnostic artifact/hash is retained in the concise
research summary; the result is not generalized to every rejection.

Operator-requested token-budget follow-up completed after the original trial.
The model-specific tokenizer matched all 87 original reported counts and all
33 final rerun counts exactly. The external research packer now selects pinned
before/after source pairs under a 30,000-token state-plus-longest-question
budget, with lexical context alignment, explicit omissions and partial-coverage
metadata. The 90,000-byte research constraint was superseded by the existing
adapter's 1,000,000-byte transport bound; the largest final body was 105,561 bytes.

Every previously unavailable sample was rerun: eleven distinct packets across
three repeats yielded 33 successful responses, no provider errors, and no
local size fallbacks. The complete dataset retains 87 unchanged original
responses plus 33 revised-packet follow-up responses, with original errors
preserved. All 120 entries still route to review, so the negative adoption
decision remains. This post-trial dataset is exploratory, not fresh independent
validation. Preparation/alignment, payload hashes, usage, response timing,
intermediate runs and complete response provenance remain in the external
archive; the concise JSON summary carries final artifact hashes.

Active work only: operator will start review after this final evidence update.
No review or integration is launched by this follow-up.


### Operator-authorized prompt and threshold follow-up

The earlier negative capture/packing decision above remains the result of its
frozen experiment. The operator subsequently requested prompt comparisons
against historical general-reviewer decisions, then explicitly chose 67%
return for the tuned gate-repair re-reviews and 81% after Jev decided the
immediately preceding round. This supersedes the original 52%/89% constraint
for that scope only; it does not establish that the original capture/packing
adoption bar passed. The operator subsequently authorized updating the mission: its recorded goal,
scope, out-of-scope threshold rule and affected success criterion now match
this follow-up. Earlier checkpoint rows are retained as explicitly superseded
historical evidence; every current criterion has fresh final evidence.

The external `prompt-comparison/` archive retains 72 calls, five historical
cases and three actual-process controls. Four historical candidates have
exact-revision approvals: the revised prompt clears three consistently
(nine of twelve calls); one remains with the reviewer. The fifth historical
candidate has no exact-revision comparator and is excluded from that claim.
`rejected-validation/` retains 36 calls across six rejected candidates and two
frozen prompts. Revised-prompt calls clear none and retain review on all 18.
Four rejection labels concern broader obligations; one family overlaps
development and two sibling cases are correlated. Threshold selection makes
this set tuning data, not independent validation of the selected limits.

`src/domain/classifier-review.ts` owns separate historical policy versions and
chooses 52%/67% for gate repairs, or 52%/81% when Jev decided the preceding
round. Consecutive repair returns retain the complete synthetic gate finding;
extra obligations retain general review. Other review types keep 52%/89%.
`src/application/review-classification/classify-review.ts` and
`src/application/review-classification/evidence-packet.ts` use the tested
repair prompt and record exact-revision pre-review verification only at its
known scope. Failed integration gate reruns and individual test results are
explicitly unknown; no claim is inferred from implementer text. At this earlier prompt-only stage, ports,
composition and adapter boundaries remained unchanged. `docs/config.md`
describes the changed routing.

Final focused checks pass 52/52 with no failures or skips in the existing
packet, repeat-review and review-decision authority suites. Static analysis
passes all four stages; docs checks, final test typecheck and diff whitespace
checks pass. `npm run test:jev-lifecycle-e2e` passes with actual Jev and isolated
Git, SQLite and Forgejo: the 52%/67% repair verdict is published and the fixture
completes integration. The 81% consecutive boundary is covered with doubles.
The fixture records fresh repair evidence with the current expected version;
its earlier stale-evidence failures remain diagnostics, not claimed passes.
Durable final logs are in the external `final-implementation/` archive, hashed
in `backlog/docs/task-2692-research-summary.json` alongside the new protocols,
results and limitations. No real mission statistics are altered by that test.

The mission-declared full gate is owned by Parallix handoff. It has not been
rerun on this final implementation tree, and the earlier full-gate result is
not claimed as verification of these later changes. The operator will start
review; this wrap-up does not launch review or integration.


### Completed production packing and tokenizer follow-up

The operator clarified that the mission must implement the successful repair
context approach. Production gate-repair packets now retain the complete diff
between the prior reviewed and verified candidate revisions. Pinned changed
files and cited context are included as complete before/after pairs when they
fit; otherwise a complete candidate file is explicitly labelled, or context
is omitted with its missing coverage disclosed. The mandatory repair diff is
never clipped. Oversized mandatory evidence retains the general reviewer.

The decision adapter imports jevtok-ts 0.2.0 and exposes model-specific token
and byte accounting through the accepted typed budget capability. It measures
the actual serialized request, with 30000 state-plus-longest-question tokens,
64000 total input tokens and the separate 1000000-byte transport bound.
Unsupported accounting falls back safely. The library and vocabulary are
embedded in the canonical bundle; no Python subprocess or runtime dependency
installation is needed. Release notices include its upstream vocabulary and
Unicode notices. Existing general-review policies remain unchanged; tuned
repair policies retain 52/67 and 52/81 after the preceding Jev decision.

The production replay retains 33 calls for 11 studied cases, zero provider
errors and zero token mismatches. Exact historical approvals yield 7 clears
and 5 reviewer fallbacks; rejection comparisons yield 12 returns and 6
reviewer fallbacks. Three returns have no exact comparator and are excluded
from contradiction claims. All 11 packets rebuilt from the final source match
the replayed request hashes. This is implementation replay of studied samples,
not independent threshold validation or a population correctness guarantee.
Original trials, failures, protocol revisions and label limitations remain.

Final proof: 101 owning unit tests pass with 500ms case headroom, no failures
or skips. Static analysis passes all four stages; docs checks pass. The
canonical bundle is 5113478 bytes within the 5MiB stop rule, and package
content audit verifies 59 files/checksums. The real Jev lifecycle test passes
in isolated Git/SQLite/Forgejo with verdict publication and integration
closeout, using 7621ms CPU within its unchanged 15000ms finite budget. Durable
logs and source/artifact hashes live in the external final-production-implementation
archive and backlog/docs/task-2692-research-summary.json:456.

The native mission readback shows six complete criteria, four recorded
checkpoints and final Goal Check coverage for every current criterion.
Historical superseded rows remain explicit. The mission stays active;
operator starts review. The declared full gate is left to Parallix handoff
and is not claimed executed on this final tree.
