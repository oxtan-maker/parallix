Before a general audit of mission paperwork, perform a short counterexample pass over the changed behavior. Finding one defect does not replace checking the other relevant boundary classes.

For each applicable class below, construct the smallest input or state that challenges an assumption in the implementation:

1. Representations: compare what the actual producer can emit with what the adapter and consumer accept. Check equivalent input forms, alternate field shapes, and legacy or partial records permitted by existing producers. Do not assume the fixtures exhaust the valid inputs. Examine conversions and defaults that can silently turn missing information into success, zero, or empty data.
2. Persistence and history: trace a write through a subsequent read and its projections. Check that accepted state round-trips and that related history, events and derived views remain consistent, including creation and completion.
3. Repeated workflows: follow a complete lifecycle, return to an earlier state, and perform the operation again. Distinguish retrying the same operation from performing a later legitimate operation on the same object.
4. Bounds and ownership: check one large accepted input and repeated ordinary use. Identify limits at process, protocol, buffer and storage boundaries. For resources created by runtime code or tests, identify the owner, retention bound and cleanup on success, failure and cancellation. Show a concrete failure mechanism; do not invent its frequency or imminence.
5. Failure paths: distinguish meaningful error classes and trace their recovery, fallback and partial side effects. Check that a successful operation cannot be mistaken for a failure, or a failed operation for success.

Trace each credible counterexample from producer through the changed code to an observable consequence. Use a small isolated probe when execution tools are available; otherwise give the exact input/state and source-derived result without claiming execution. Record a public-contract violation even if current CLI wiring masks it; assess production reachability separately. Flag conflicts in the required policy as questions rather than silently changing that policy.

Report each established defect promptly with its trigger, path, observable failure and evidence. Keep unverified suspicions separate. Verify claimed command or gate differences against their implementation and aliases. State which relevant checks remain unresolved rather than treating missing evidence as correctness.

Do not run large batched test coverage commands that Parallix has already run or intentionally schedules for a later verification phase. Run a focused test only when it validates a specific review finding.
