# CP-4: ADR 0032 and ADR 0036 updated with NEL bucket terminology

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC6: ADR 0032 no longer defines "Estimated agent % usage limit" | `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md:58` now reads `- Predicted NEL bucket: one of Small (0–80), Medium (81–235), Large (235+) per ADR 0047` | PASS |
| SC6: ADR 0032 references NEL buckets and cross-references ADR 0047 | `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md:63-68` interpretation rule references NEL; `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md:137` Links section includes ADR 0047 | PASS |
| SC6: ADR 0032 default activation guidance uses NEL buckets | `docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md:70-74` guidance references Small/Medium/Large buckets | PASS |
| SC7: ADR 0036 no longer references agent-specific "% usage" thresholds | `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md:21-27` Agent Budget column replaced with NEL Budget | PASS |
| SC7: ADR 0036 "Too Large" restated in NEL bucket terms | `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md:29-37` thresholds now use NEL buckets with ADR 0047 reference | PASS |
| SC7: ADR 0036 cross-references ADR 0047 | `docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md:82` Links section includes ADR 0047 | PASS |
| No other ADR files modified | Only `docs/adr/0032-*.md` and `docs/adr/0036-*.md` edited; ADR 0047 and others untouched | PASS |

Next action: CP-5 — Run verification: `npm test`, `./scripts/verify-local.sh docs`.
