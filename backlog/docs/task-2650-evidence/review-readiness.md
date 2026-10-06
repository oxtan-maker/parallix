# TASK-2650: independent review entry point

The operator authorized an expanded evaluation after the initial Kev-only delivery. Review the final scope and conclusions, including negative results and source limitations, against the authoritative Mission brief/checkpoints in `px status task-2650`.

## Final change

ADR 0065 remains Proposed. The mission delivers evidence and recommendations, not a production classifier feature. TASK-2658 and TASK-2659 were created at the operator's explicit request. Historical experimental access was read-only; updates to this mission's brief/checkpoints and Backlog task bodies are authorized administrative changes.

Detailed research is preserved in the host-local external archive at `/mnt/data/code/parallix-artice-data/task-2650/`: exact inputs, model outputs, historical source, old ADR narrative, research scripts and inventory hashes. [archive-index.json](archive-index.json) records the absolute location and hashes. Summaries stay in this repo. Removed analysis scripts/evidence were archived rather than discarded. No production source or workflow configuration changed relative to baseline `d645516aa`.

## Goal Check

| Success criterion | Evidence |
|---|---|
| Source coverage | `/mnt/data/code/parallix-artice-data/task-2650/task-2650-evidence-original-20261006/pr-census.json` and `source-audit.json`: 595 PRs, paginated collection, reviewed revisions/statuses, snapshot/cutoff and coverage gaps. Collection is not an atomic provider snapshot or human deep review of every PR. |
| Historical bug reconstruction | Archived `incident-corpus.json`/`bug-audit.json`: deleted/moved Git records, 253 bug-labeled records and explicit alias families. Five families have deeper inspection; labels/leads/aliases are not independent confirmed bugs, and most causality remains unknown. |
| Bounded decisions and responsibility | [ADR decision matrix](../../../docs/adr/0065-local-review-classification-evidence.md); archive records define outcomes, inputs, errors, preparation and remaining reviewer work. |
| Actual local experiment | Archived `kev-runtime.json`, `kev-development.json`, `kev-final.json`: real pointer-head Kev run on RTX 5060 Ti; exact historical configuration and case outputs. Cold start/true process peak remain unmeasured; later operator model changes do not rewrite those results. |
| Comparators and split control | Archived original `cases.json`/`results.json`, review protocol/replays and controlled retrospective; final mechanical `locked-protocol.json`, candidate sample and packets frozen before calls. Original unrestricted discovery and independent human bug truth are not claimed. |
| Quality, costs and uncertainty | [Final validation](final-validation.md): 3/20 clears matching historical approvals, zero returns, 17 escalations including six context fallbacks. Packet/API time 7.81 seconds; 14.7% saving assumes two-minute review rounds. Three clears do not establish a low false-pass rate. Earlier real false clear, new finding and reviewer false alarm remain archived. |
| Proposed decision and boundaries | [ADR](../../../docs/adr/0065-local-review-classification-evidence.md), [summary](summary.md), TASK-2658/TASK-2659. Two implementation follow-ups, no production behavior or authority changes. |

## Verification

Focused checks are appropriate to documentation/evidence changes and removed research scripts. Current check outputs and tree/source manifests are archived under `review-preparation/`. The declared `./scripts/verify-local.sh all` gate remains unchanged; its old green run does not prove today's tree. Normal workflow gating remains for the subsequent review/handoff.

The reviewer can validate exact packet hashes and recompute routing/cost summaries without rerunning paid/local models. Inspect the archive only as needed; it contains large historical inputs. Historical reviewer agreement, manually labeled capability controls and reproduced bug truth are distinct targets.

## Material limitations

TASK-2498 review metadata pins the tested fix commit, which its body confirms; another mentioned HEAD was unavailable. Families unavailable after squashes were excluded before locking source-retrievable samples. Context fallbacks remain in the denominator. Ornith packaging failures and the stopped uncapped thinking run count as operational failures, not incorrect bug labels. Possible prior exposure in current general-review models remains disclosed.

Preparation ends with refreshed checkpoint evidence. Independent review is the next operator action; no review decision is recorded by this mission preparation.
