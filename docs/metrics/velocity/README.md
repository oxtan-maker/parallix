# Throughput methodology

This is observational one-maintainer dogfooding, not a controlled benchmark. It makes no causal claim or productivity multiplier claim.

The graph counts completed Parallix missions. One current observation is a canonical lifecycle outcome whose `integration → done` completion is recorded in local operator state; commits, telemetry rows, agent runs, checkpoints, and review rounds do not count. The exporter reads that existing outcome population and publishes only aggregate weekly counts.

Weeks are UTC ISO weeks: Monday 00:00:00 through Sunday 23:59:59.999. The current partial week is excluded; every full week from the first available outcome to the last completed week is retained, including zeroes. The committed snapshot currently observes the dates stated in `weekly.json`.

The [historical manual baseline](historical-baseline.md) is an aggregate rate, not invented weekly data: nine coherent predecessor work clusters over 2022-08-16 through 2022-09-16 (32 days), yielding `9 / 32 × 7 = 1.96875` delivery units per week. Retained predecessor clusters and completed current missions are observationally comparable delivered engineering work, but are not identical in size or difficulty. It is from an earlier product phase and codebase maturity, so its only display is a labelled reference line; the graph makes no productivity-multiplier or causal claim.

Refresh with `npm run docs:velocity:export`, render with `npm run docs:velocity:render`, and check the committed SVG with `npm run docs:velocity:verify`.
