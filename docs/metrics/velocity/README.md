# Throughput methodology

This is observational one-maintainer dogfooding, not a controlled benchmark. It makes no causal claim or productivity multiplier claim.

The graph counts completed `user_value` delivery units. For Parallix, one unit is a canonical lifecycle outcome whose `integration → done` completion is recorded in local operator state; commits, telemetry rows, agent runs, checkpoints, and review rounds do not count. The exporter reads that existing outcome population, filters the same `user_value` classification as the baseline, and publishes only aggregate weekly counts.

Weeks are UTC ISO weeks: Monday 00:00:00 through Sunday 23:59:59.999. The current partial week is excluded; every full week from the first available outcome to the last completed week is retained, including zeroes. The committed snapshot currently observes the dates stated in `weekly.json`.

The manual reference is an aggregate rate, not invented weekly data: nine coherent user-value clusters over 2022-08-16 through 2022-09-16 (32 days), from the retained Git document and command recorded in `weekly.json`. It is from an earlier product phase and codebase maturity, so its only display is a labelled reference line.

Refresh with `npm run docs:velocity:export`, render with `npm run docs:velocity:render`, and check the committed SVG with `npm run docs:velocity:verify`.
