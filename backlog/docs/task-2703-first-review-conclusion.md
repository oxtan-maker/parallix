# TASK-2703: first-review classification conclusion

Restore general review for first reviews. Keep Jev available for the existing
finding-resolution and integration-repair re-reviews, with their current policies.
Show re-review statistics only while retaining historical measurement collection.

Thirty original Forgejo first-review subjects produced 11 clears, 2 returns and
17 fallbacks: 29 live calls plus one preparation-budget fallback. Eight clears
agreed with historical approvals; one return was supported. Two clears missed
original-scope defects. Another clear satisfied the mission criteria but missed
a valid broader PR blocker. One return evaluated a later criterion and cannot
establish original-review agreement. These are conditional, previously exposed
samples with root adjudication, not an independent accuracy estimate.

The important counterexample is TASK-2569: the implementation and all three
success criteria passed, yet the historical reviewer correctly rejected the PR
for documentation inconsistency. Criterion satisfaction is insufficient evidence
for PR approval. TASK-2626 and TASK-2579 additionally show that focused green tests
can conceal a fallback defect or mocks that misrepresent a real interface.
Increasing a clear threshold cannot be assumed to solve either problem.

The major error is clearing a PR that the historical reviewer correctly rejected.
A false return has an implementer/review cost that belongs in aggregate economics.
General-review correctness is not presumed perfect; disputed historical findings
need adjudication, without replacing every historical approval with an unusually
intensive new review.

Earlier positive development and validation results primarily concern resolution
of known findings. They do not justify first-review approval, and this conclusion
does not justify disabling those re-review paths.

[Evidence index](task-2703-first-review-evidence.json) points to the complete raw
archive, frozen inputs, responses, tests, comparator reviews and cohort analysis
in `../parallix-research`. No research sample applied a production verdict.
