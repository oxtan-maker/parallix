# TASK-2289 contract-to-ADR/test matrix

This matrix fixes the executable boundary for this mission. It records the
ADR 0051 rules that the new application contracts and their tests must prove;
it does not delegate either legacy CLI handler.

| ADR 0051 rule | Application contract | Verification target |
|---|---|---|
| One terminal outcome with a typed error or value | `ApplicationOutcome` and `ApplicationError` | `test/application-contracts.test.ts` |
| Read projections identify source and staleness | `StatsProjection` source facts | `test/application-contracts.test.ts` |
| Progress is ordered and not durable authority | `ProgressEvent` and operation ID | `test/application-services.test.ts` |
| Cancellation only occurs at safe boundaries | `Cancellation` and partial durable evidence | `test/application-services.test.ts` |
| Capabilities are checked before mutation | `Capability` and active mutation port tests | `test/application-services.test.ts` |
| Legacy text, JSON, and exits stay at the CLI edge | Existing direct handlers remain characterized | `test/stats-backfill.test.ts`; `test/active.test.ts` |
| Concrete effects stay outside application/domain code | consumer-owned ports and import guard | `test/application-boundaries.test.ts` |
| Only the composition root assembles all adapters | named composition root and wiring guard | `test/application-boundaries.test.ts` |

The tests named above are added in CP 2–CP 3. The two existing handler test
files are characterization evidence captured before any application code is
introduced.
