# Opt-in verification profiling

Ordinary verification does not require a profiler. To investigate Node and
TypeScript execution from a development checkout, explicitly run:

```sh
npx tsx scripts/profile-verification.ts tmp/my-profile test/unit/application/services/statistics-contract.test.ts
```

The command runs paired controls and V8 CPU sampling, in both plain and
coverage-enabled modes, with three pairs by default. Set
`PARALLIX_PROFILE_SAMPLES` to choose the number of pairs. It requires the
checkout's Node/tsx toolchain and a C compiler for the existing OS CPU meter.
It does not alter verification selection, limits, budgets or gate configuration.
Use an isolated checkout and operator environment for workloads with effects.

Keep the entire output directory. It contains compressed raw CPU captures,
command output, OS CPU records and a report identifying revision, runtime,
workload, sample counts and paired overhead. An existing run directory is never
overwritten. A dirty revision is explicitly identified; preserve the corresponding
source patch or commit it before collecting a comparison. Captures can contain
local paths and function names; review them before sharing.

V8 samples describe individual isolates. Test workers inherit profiling flags;
arbitrary external programs and children that replace those flags do not.
Summing concurrent isolate samples does not produce OS process-tree CPU.
The OS meter includes waited descendants, while a parent blocked in a subprocess
does not reveal the child's internal hotspots. Imports, compilation, fixtures,
coverage and GC can overlap in call stacks; unresolved attribution stays unknown.

Compare equivalent commands, test populations, runtime versions, configuration
and coverage modes. Retain every control and sampled observation, alternate
their order, and disclose sample sizes and host/cache variability. A faster
sampled run indicates noise or ordering effects, not negative intrinsic profiler
overhead. Neither wall/CPU ratios nor overlapping executions alone establish
resource contention or a guaranteed optimization benefit.

To reference a retained experiment in subsequent command measurements, set
`PARALLIX_VERIFICATION_PROFILE_REPORT` to its existing report path. FLOW and
`px stats` display this reference. It is contextual evidence: they do not claim
that those later attempts were sampled or had the same workload. Keep the
referenced captures with the report; missing samples remain unknown.

The [retained example](../evidence/verification-profile/analysis.json) ranks
repeated timezone construction as an application investigation candidate,
alongside startup/source-map work and GC. Its paired sampled runs were faster
than controls, so causal profiler overhead remains unresolved. That evidence
supports investigating timezone construction before changing verification
scheduling; it does not establish a speedup or implement an optimization.
