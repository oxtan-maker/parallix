# CP-4 — Single-source authoring guidance

## Summary

Updated the documentation standard and repository instructions to make the
single-source model explicit. The guidance now separates durable authored
documentation from checkpoint evidence and makes semantic change—not internal
layout churn—the trigger for documentation updates.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Standard prohibits volatile implementation evidence in authored docs | `docs/doc-standards.md:77` | PASS |
| Standard separates checkpoint evidence from live authored documentation | `docs/doc-standards.md:87` | PASS |
| Standard states behavior-preserving refactors normally need no doc update | `docs/doc-standards.md:90` | PASS |
| Repository guidance enforces the same single-source rule | `AGENTS.md:17` | PASS |
| Repository guidance requires semantic impact before live-doc updates | `AGENTS.md:27` | PASS |

Next action: Reconcile the four authored surfaces against HEAD, update the graph, and run the declared final verification gate.
