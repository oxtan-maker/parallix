# Lint baseline ratchet

Parallix's static-analysis gate type-checks production TypeScript in `src/` and
`web/`. Promise handling is clean-by-default: a floating or misused promise
blocks the gate immediately.

Some existing type-safety and maintainability debt is tracked instead of being
silently tolerated. The committed lint baseline records the allowed count for
explicit `any`, unsafe assignments, cyclomatic complexity, and function length.
The initial complexity limit is 15: the measured violation distribution was a
median of 20, a 90th percentile of 38, and a maximum of 144. Function length
is limited to 100 effective lines; its measured violating population had a
median of 155, a 90th percentile of 344, and a maximum of 494.

The gate requires every recorded count to match its baseline exactly. A new
violation fails the build. A reduction also stops the build and tells the
author to lower the committed number, preventing an accidental baseline from
being left above the code's actual debt.

When intentionally removing a tracked violation, run the static-analysis gate,
update the relevant count in the baseline to the reported current count, and
run the gate again. Do not add promise rules to this file: those are expected
to stay at zero. The GitHub required workflow runs the same static-analysis
entry point, so local and hosted checks enforce the same policy.
