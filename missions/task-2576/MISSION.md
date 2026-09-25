# Mission: Show truthful web agent activity (task-2576)

## Goal

Keep integration and other deterministic work visible as progress on the web board without showing a blinking agent indicator or an active-worker label. Name the worker from published work only when a live session is also observed.

## Scope

- Correct the web card's running indicator and worker label.
- Reproduce a live coordinator doing deterministic work alongside a live agent case.
- Remove redundant repository-agent instructions and update the operator explanation.

## Success criteria

- A card with live integration work and a live `px` coordinator, but no named work agent, has no blinking indicator or active-worker label.
- A card with fresh named agent work and an observed live session identifies that agent and blinks.
- Stale work does not blink, even if a coordinator remains live.
- Focused rendering tests, static analysis, and documentation verification pass on the final tree.

## Checkpoint

See `CP-1.md` for verification evidence and the remaining limitation.
